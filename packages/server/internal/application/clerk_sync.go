package application

import (
	"context"
	"errors"
	"strings"
	"time"

	"budgero-server/internal/adapter/driven/mailerlite"
	emailpkg "budgero-server/internal/application/email"
	"budgero-server/internal/config"
	"budgero-server/internal/domain"
	"budgero-server/internal/port/driving"
	"budgero-server/internal/strutil"

	"github.com/clerk/clerk-sdk-go/v2"
	"github.com/clerk/clerk-sdk-go/v2/user"
	"github.com/rs/zerolog/log"
)

// placeholderEmailSuffix is appended to clerkID when we couldn't fetch the
// real email from Clerk (rate limit, transient API error, etc.). Any address
// ending in this suffix is unroutable and must be excluded from outbound
// email + downstream marketing sync.
const placeholderEmailSuffix = "@clerk.user"

// isPlaceholderEmail returns true for the synthesized clerkID@clerk.user
// addresses we fall back to when Clerk's user-fetch call fails.
func isPlaceholderEmail(email string) bool {
	return strings.HasSuffix(strings.ToLower(email), placeholderEmailSuffix)
}

// ClerkUser contains normalized user data from Clerk.
type ClerkUser struct {
	ID        string
	Email     string
	FirstName string
	LastName  string
	FullName  string
	Username  string
}

// ClerkSyncUsecase handles Clerk authentication provider integration.
// This is an orchestrator - it coordinates between Clerk API and domain services.
type ClerkSyncUsecase struct {
	users driving.UserService
	admin driving.AdminService
	cfg   *config.Config
	// email is optional; nil when EMAIL_ENABLED=false or RESEND_API_KEY unset.
	// When non-nil, a welcome email fires asynchronously after each user create.
	email *emailpkg.Service
}

// NewClerkSyncUsecase creates a new ClerkSyncUsecase.
func NewClerkSyncUsecase(users driving.UserService, admin driving.AdminService, cfg *config.Config) *ClerkSyncUsecase {
	return &ClerkSyncUsecase{
		users: users,
		admin: admin,
		cfg:   cfg,
	}
}

// SetEmailService attaches the email service post-construction. Separate
// from the constructor so we don't have to thread the email dependency
// through every callsite that builds ClerkSyncUsecase (tests, etc.).
func (uc *ClerkSyncUsecase) SetEmailService(svc *emailpkg.Service) {
	uc.email = svc
}

// Init initializes the Clerk SDK with the secret key from config.
func (uc *ClerkSyncUsecase) Init() {
	if uc.cfg != nil && uc.cfg.Auth.ClerkSecretKey != "" {
		clerk.SetKey(uc.cfg.Auth.ClerkSecretKey)
	}
}

// FetchUser fetches a user from Clerk by ID.
func (uc *ClerkSyncUsecase) FetchUser(ctx context.Context, clerkID string) (*ClerkUser, error) {
	cu, err := user.Get(ctx, clerkID)
	if err != nil {
		return nil, err
	}
	return uc.normalizeClerkUser(cu, clerkID), nil
}

// SyncOrCreateUser ensures a local user exists for the given Clerk ID.
// It handles:
// - Fetching existing user by ID
// - Migrating user if email exists under different ID
// - Creating new user if not found
// - Syncing name/email from Clerk if changed
func (uc *ClerkSyncUsecase) SyncOrCreateUser(ctx context.Context, clerkID string) (*domain.User, error) {
	uc.Init()

	// Fetch from Clerk
	clerkUser, err := uc.FetchUser(ctx, clerkID)
	if err != nil {
		log.Debug().Err(err).Str("clerk_id", clerkID).Msg("failed to fetch Clerk user")
		// Continue with fallback identity
		clerkUser = &ClerkUser{
			ID:       clerkID,
			Email:    clerkID + placeholderEmailSuffix,
			FullName: "User",
		}
	}

	// Try to get existing local user
	localUser, err := uc.users.GetByID(ctx, clerkID)
	if err == nil {
		// User exists - sync name/email if changed
		return uc.syncExistingUser(ctx, localUser, clerkUser)
	}

	// User not found - try to find by email and migrate, or create new
	return uc.findOrCreateUser(ctx, clerkID, clerkUser)
}

// syncExistingUser updates local user if Clerk data has changed.
func (uc *ClerkSyncUsecase) syncExistingUser(ctx context.Context, localUser *domain.User, clerkUser *ClerkUser) (*domain.User, error) {
	needsUpdate := false
	newName := localUser.Name
	newEmail := localUser.Email

	if clerkUser.FullName != "" && clerkUser.FullName != localUser.Name {
		newName = clerkUser.FullName
		needsUpdate = true
	}
	if clerkUser.Email != "" && clerkUser.Email != localUser.Email {
		newEmail = clerkUser.Email
		needsUpdate = true
	}

	if needsUpdate {
		if updateErr := uc.users.Update(ctx, localUser.ID, newName, newEmail); updateErr != nil {
			// If email conflict, try updating name only
			if errors.Is(updateErr, domain.ErrEmailAlreadyExists) {
				if nameUpdateErr := uc.users.Update(ctx, localUser.ID, newName, localUser.Email); nameUpdateErr != nil {
					log.Warn().Err(nameUpdateErr).Str("user_id", localUser.ID).Msg("failed to update user name after email conflict")
				}
			} else {
				log.Warn().Err(updateErr).Str("user_id", localUser.ID).Msg("failed to sync Clerk user updates")
			}
		}
		// Re-fetch updated user
		if updated, err := uc.users.GetByID(ctx, localUser.ID); err == nil {
			return updated, nil
		}
	}

	return localUser, nil
}

// findOrCreateUser handles user creation or migration for new Clerk IDs.
func (uc *ClerkSyncUsecase) findOrCreateUser(ctx context.Context, clerkID string, clerkUser *ClerkUser) (*domain.User, error) {
	email := clerkUser.Email
	name := clerkUser.FullName
	if name == "" {
		name = "User"
	}

	// Check if user exists with same email under different ID
	if existingByEmail, err := uc.users.GetByEmail(ctx, email); err == nil && existingByEmail.ID != clerkID {
		// Migrate to new Clerk ID
		if err := uc.admin.MigrateUserID(ctx, existingByEmail.ID, clerkID, name, email); err == nil {
			if migrated, err := uc.users.GetByID(ctx, clerkID); err == nil {
				return migrated, nil
			}
		}
	}

	// Create new user
	created, err := uc.users.Create(ctx, clerkID, name, email)
	if err != nil {
		// Handle race condition - user might have been created
		if existing, getErr := uc.users.GetByID(ctx, clerkID); getErr == nil {
			return existing, nil
		}
		return nil, err
	}

	// Skip outbound sends when we only have the synthesized clerk_id@clerk.user
	// placeholder — those addresses bounce 100% of the time and would burn
	// our domain reputation on Resend. The next successful Clerk sync will
	// repair the email; the scheduler's welcome catchup picks it up on the
	// next pass once a real address is in place (see WelcomeCatchup).
	if isPlaceholderEmail(email) {
		log.Info().Str("user_id", created.ID).
			Msg("Skipping welcome email + MailerLite for placeholder email; will retry once Clerk sync provides the real address")
		return created, nil
	}

	// Add new user to MailerLite asynchronously
	if uc.cfg.HasMailerLite() {
		go func() {
			client := mailerlite.NewClient(uc.cfg.External.MailerLiteAPIKey, uc.cfg.External.MailerLiteGroupID)
			if _, err := client.AddSubscriber(email, name); err != nil {
				log.Warn().Err(err).Str("email", email).Msg("Failed to add new user to MailerLite")
			} else {
				log.Info().Str("email", email).Msg("Added new user to MailerLite")
			}
		}()
	}

	// Fire welcome email asynchronously. If this goroutine's send fails
	// (transient Resend error, process killed), the scheduler's welcome
	// catch-up pass will retry within ~10 min — see email/scheduler.go.
	//
	// We derive from the request ctx via WithoutCancel so we keep any
	// trace/log values attached to the request, but don't die when the
	// HTTP handler returns.
	if uc.email != nil {
		userID := created.ID
		userEmail := email
		userName := name
		bgCtx := context.WithoutCancel(ctx)
		go func() {
			sendCtx, cancel := context.WithTimeout(bgCtx, 30*time.Second)
			defer cancel()
			firstName := strutil.FirstWord(userName)
			if err := uc.email.SendOnce(sendCtx, userID, userEmail, firstName, emailpkg.TemplateWelcome); err != nil {
				log.Warn().Err(err).Str("user_id", userID).Str("email", userEmail).
					Msg("Failed to send welcome email (scheduler will retry)")
			}
		}()
	}

	return created, nil
}

// normalizeClerkUser extracts normalized data from Clerk user response.
func (uc *ClerkSyncUsecase) normalizeClerkUser(cu *clerk.User, fallbackID string) *ClerkUser {
	result := &ClerkUser{
		ID:       fallbackID,
		Email:    fallbackID + placeholderEmailSuffix,
		FullName: "User",
	}

	if cu == nil {
		return result
	}

	result.ID = cu.ID

	// Extract email
	if len(cu.EmailAddresses) > 0 {
		// Prefer primary email
		for _, ea := range cu.EmailAddresses {
			if cu.PrimaryEmailAddressID != nil && ea.ID == *cu.PrimaryEmailAddressID {
				result.Email = ea.EmailAddress
				break
			}
		}
		if result.Email == fallbackID+placeholderEmailSuffix {
			result.Email = cu.EmailAddresses[0].EmailAddress
		}
	}

	// Extract name
	if cu.FirstName != nil {
		result.FirstName = *cu.FirstName
	}
	if cu.LastName != nil {
		result.LastName = *cu.LastName
	}
	if cu.Username != nil {
		result.Username = *cu.Username
	}

	// Build full name
	switch {
	case result.FirstName != "" && result.LastName != "":
		result.FullName = result.FirstName + " " + result.LastName
	case result.FirstName != "":
		result.FullName = result.FirstName
	case result.Username != "":
		result.FullName = result.Username
	}

	return result
}

// UpdateClerkProfile updates the user's name in Clerk.
func (uc *ClerkSyncUsecase) UpdateClerkProfile(ctx context.Context, clerkID, fullName string) error {
	uc.Init()

	firstName, lastName := splitFullName(fullName)
	_, err := user.Update(ctx, clerkID, &user.UpdateParams{
		FirstName: clerk.String(firstName),
		LastName:  clerk.String(lastName),
	})
	return err
}

func splitFullName(fullName string) (firstName, lastName string) {
	parts := strings.Fields(fullName)
	if len(parts) == 0 {
		return "User", ""
	}
	if len(parts) == 1 {
		return parts[0], ""
	}
	return parts[0], strings.Join(parts[1:], " ")
}
