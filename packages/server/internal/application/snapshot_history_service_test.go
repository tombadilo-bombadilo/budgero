package application_test

import (
	"fmt"
	"testing"
	"time"

	"budgero-server/internal/application"
	"budgero-server/internal/domain"
)

func TestSnapshotsToPrune(t *testing.T) {
	now := time.Date(2026, 10, 31, 12, 0, 0, 0, time.UTC)
	at := func(daysAgo, hour int) time.Time {
		d := now.AddDate(0, 0, -daysAgo)
		return time.Date(d.Year(), d.Month(), d.Day(), hour, 0, 0, 0, time.UTC)
	}
	// Newest first, as the repository lists them.
	entries := []domain.SnapshotHistoryEntry{
		{ID: 10, BecameCurrentAt: at(0, 11)},
		{ID: 9, BecameCurrentAt: at(0, 10)},
		{ID: 8, BecameCurrentAt: at(0, 9)},
		{ID: 7, BecameCurrentAt: at(1, 20)},
		{ID: 6, BecameCurrentAt: at(1, 8)},
		{ID: 5, BecameCurrentAt: at(4, 8)},
		{ID: 4, BecameCurrentAt: at(6, 13)}, // inside the 7-day window
		{ID: 3, BecameCurrentAt: at(8, 8)},  // outside it
		{ID: 2, BecameCurrentAt: at(30, 8)},
	}
	ids := func(es []domain.SnapshotHistoryEntry) string {
		out := []int64{}
		for _, e := range es {
			out = append(out, e.ID)
		}
		return fmt.Sprint(out)
	}

	for _, tc := range []struct {
		name       string
		keep, days int
		want       string
	}{
		{"count only", 3, 0, "[7 6 5 4 3 2]"},
		{"count plus newest per day", 2, 7, "[8 6 3 2]"},
		{"daily only", 0, 7, "[9 8 6 3 2]"},
		{"keep covers everything", 20, 7, "[]"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := ids(application.SnapshotsToPrune(entries, tc.keep, tc.days, now)); got != tc.want {
				t.Errorf("pruned = %s, want %s", got, tc.want)
			}
		})
	}
}

func TestSnapshotHistoryEntryRestorableOver(t *testing.T) {
	current := &domain.SpaceBlob{EncryptionKeyVersion: 2, DataFormatVersion: 2}
	for _, tc := range []struct {
		key, format int64
		want        bool
	}{
		{2, 2, true},
		{2, 1, true},
		{1, 2, false},
		{3, 2, false},
		{2, 3, false},
	} {
		e := &domain.SnapshotHistoryEntry{EncryptionKeyVersion: tc.key, DataFormatVersion: tc.format}
		if got := e.RestorableOver(current); got != tc.want {
			t.Errorf("key %d format %d: restorable = %v, want %v", tc.key, tc.format, got, tc.want)
		}
	}
}
