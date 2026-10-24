import { EmailLink } from '@/components/email-link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { withLocalizedUrls } from '@/lib/localized-metadata';

export const dynamic = 'force-static';
export const revalidate = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'privacy' });
  return withLocalizedUrls(locale, '/privacy', {
    title: t('meta_title'),
    description: t('meta_description'),
    alternates: { canonical: 'https://budgero.app/privacy' },
    openGraph: {
      title: t('meta_title'),
      description: t('og_description'),
      url: 'https://budgero.app/privacy',
    },
  });
}

export default async function PrivacyPolicy({
  params,
}: {
  params: Promise<{
    locale: string;
  }>;
}) {
  const copy = await getTranslations({
    locale: (await params).locale,
    namespace: 'updates',
  });
  const { locale } = await params;

  setRequestLocale(locale);
  const t = await getTranslations({
    locale: (await params).locale,
    namespace: 'privacy',
  });
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-gray-100 to-gray-200 dark:from-black dark:via-gray-900/50 dark:to-gray-800">
      <div className="container mx-auto px-4 pt-24 md:pt-28 pb-16 max-w-4xl">
        <div className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-xl rounded-2xl p-8 shadow-2xl border border-white/50 dark:border-gray-700/50">
          <h1 className="text-4xl font-black text-gray-900 dark:text-white mb-2">
            {t('privacy_policy')}
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mb-1">
            <strong>{t('last_updated')}</strong> {t('24_october_2026')}{' '}
          </p>
          <p className="text-gray-600 dark:text-gray-400 mb-8">
            <strong>{t('effective')}</strong> {t('29_april_2026')}{' '}
          </p>

          <div className="prose prose-lg dark:prose-invert max-w-none prose-table:text-sm prose-th:text-left prose-th:bg-gray-100 dark:prose-th:bg-gray-900/40 prose-td:align-top prose-headings:scroll-mt-24">
            <p> {t('this_privacy_policy_explains_what_personal')} </p>
            <p>
              {' '}
              {t('it_s_written_in_plain_english')}{' '}
              <EmailLink email="privacy@budgero.app" className="font-bold" />.
            </p>
            <hr />

            <h2>{t('1_who_we_are')}</h2>
            <p> {t('budgero_is_the_data_controller_for')} </p>
            <p>
              <strong>{t('privacy_contact')}</strong> <EmailLink email="privacy@budgero.app" />
              <br />
              <strong>{t('general_contact')}</strong> <EmailLink email="hello@budgero.app" />
            </p>
            <p> {t('at_budgero_s_current_scale_small')} </p>

            <hr />

            <h2>{t('2_the_short_version')}</h2>
            <ul>
              <li>
                <strong>{t('your_financial_data_is_end_to')}</strong>{' '}
                {t('transactions_budgets_balances_categories_and_not')}{' '}
              </li>
              <li>
                <strong>{t('the_rest_is_normal_saas_data')}</strong>{' '}
                {t('running_the_service_still_requires_an')}{' '}
              </li>
              <li>
                <strong>{t('personal_data_is_never_sold')}</strong>{' '}
                {t('budgero_doesn_t_share_data_with_advertisers')}{' '}
              </li>
              <li>
                <strong>{t('you_have_full_rights')}</strong>{' '}
                {t('under_gdpr_uk_gdpr_ccpa_including')}{' '}
              </li>
              <li>
                <strong>{t('no_tracking_cookies_no_ads')}</strong>{' '}
                {t('budgero_sets_no_analytics_or_advertising')}{' '}
              </li>
            </ul>

            <hr />

            <h2>{t('3_what_personal_data_is_collected')}</h2>

            <h3>{t('3_1_account_data')}</h3>
            <ul>
              <li>{t('email_address')}</li>
              <li> {t('password_never_stored_in_plain_text')} </li>
              <li>{t('account_preferences_and_settings')}</li>
              <li>{t('a_unique_account_identifier_clerk_user')}</li>
            </ul>

            <h3>{t('3_2_encrypted_vault_data_zero')}</h3>
            <ul>
              <li>{t('transactions_budgets_balances_categories_notes_s')}</li>
              <li>{t('encrypted_on_your_device_with_aes')}</li>
              <li>{t('only_the_resulting_ciphertext_is_stored')}</li>
            </ul>
            <p>
              <strong>
                {t('what_zero_knowledge_does')} <em>{t('not')}</em> {t('cover')}
              </strong>{' '}
              {t('to_make_shared_workspaces_and_real')}{' '}
            </p>

            <h3>{t('3_3_billing_and_subscription_data')}</h3>
            <ul>
              <li>{t('plan_price_currency_subscription_status_renewal')}</li>
              <li>{t('order_id_last_four_digits_of')}</li>
              <li>
                {' '}
                {t('full_payment_instrument_data_card_number')} <strong>{t('not')}</strong>{' '}
                {t('by_budgero')}{' '}
              </li>
            </ul>

            <h3>{t('3_4_service_email_metadata')}</h3>
            <ul>
              <li> {t('send_open_bounce_events_for_transactional')} </li>
            </ul>

            <h3>{t('3_5_product_analytics_cookieless')}</h3>
            <p>{t('budgero_cloud_records_how_the_product')}</p>
            <p>
              <strong>{t('what_is_recorded')}</strong>
            </p>
            <ul>
              <li>{t('pa_pages')}</li>
              <li>{t('pa_onboarding')}</li>
              <li>{t('pa_imports')}</li>
              <li>{t('pa_bank_sync')}</li>
              <li>{t('pa_features')}</li>
              <li>{t('pa_ai')}</li>
              <li>{t('pa_settings')}</li>
              <li>{t('pa_account')}</li>
              <li>{t('pa_sync')}</li>
              <li>{t('pa_reliability')}</li>
              <li>{t('pa_context')}</li>
            </ul>
            <ul>
              <li>{t('every_detail_attached_to_an_event')}</li>
              <li>{t('once_you_re_logged_in_events')}</li>
              <li>{t('some_events_are_sent_by_the_server')}</li>
              <li> {t('ip_address_used_at_request_time')} </li>
              <li>{t('cookieless_the_analytics_library_keeps')}</li>
            </ul>
            <p>
              <strong>{t('never_collected')}</strong>{' '}
              {t('names_of_transactions_accounts_categories')}
            </p>
            <p>
              <strong>{t('switch_it_off')}</strong> {t('settings_security_privacy_in_the_app')}
            </p>

            <h3>{t('3_6_website_analytics_cookieless')}</h3>
            <p>{t('on_the_budgero_website_page_views')}</p>
            <ul>
              <li>
                <strong>{t('umami')}</strong> {t('umami_desc')}
              </li>
              <li>
                <strong>{t('posthog')}</strong> {t('posthog_website_desc')}
              </li>
            </ul>

            <h3>{t('3_7_server_security_logs')}</h3>
            <ul>
              <li> {t('request_logs_from_the_hosting_provider')} </li>
            </ul>

            <p>
              <strong>{t('not_collected')}</strong>{' '}
              {t('financial_account_credentials_budgero_doesn_t')}{' '}
            </p>

            <hr />

            <h2>{t('4_why_it_s_used_and')}</h2>
            <p> {t('for_users_in_the_eu_uk')} </p>

            <table>
              <thead>
                <tr>
                  <th>{t('purpose')}</th>
                  <th>{t('categories_of_data')}</th>
                  <th>{t('lawful_basis_gdpr_art_6')}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td> {t('provide_the_budgero_service_account_creation')} </td>
                  <td>{t('account_data_encrypted_vault_data')}</td>
                  <td>{t('performance_of_a_contract_art_6')}</td>
                </tr>
                <tr>
                  <td>{t('take_payment_and_manage_your_subscription')}</td>
                  <td>{t('billing_subscription_data')}</td>
                  <td>{t('performance_of_a_contract_art_6')}</td>
                </tr>
                <tr>
                  <td> {t('send_service_emails_welcome_feedback_check')} </td>
                  <td>{t('email_send_open_bounce_metadata')}</td>
                  <td> {t('performance_of_a_contract_art_6_2')} </td>
                </tr>
                <tr>
                  <td>{t('comply_with_tax_accounting_and_other')}</td>
                  <td>{t('billing_subscription_data')}</td>
                  <td>{t('legal_obligation_art_6_1_c')}</td>
                </tr>
                <tr>
                  <td>{t('detect_investigate_and_prevent_abuse_fraud')}</td>
                  <td>{t('server_logs_ip_account_data')}</td>
                  <td> {t('legitimate_interest_in_protecting_the_service')} </td>
                </tr>
                <tr>
                  <td>{t('product_analytics_which_features_get_used')}</td>
                  <td>{t('pseudonymous_analytics_events_app_and_server')}</td>
                  <td>{t('legitimate_interest_in_improving_and_fixing')}</td>
                </tr>
                <tr>
                  <td>{t('website_analytics_how_people_find_budgero')}</td>
                  <td>{t('website_statistics_3_6')}</td>
                  <td>{t('legitimate_interest_in_understanding_how_people')}</td>
                </tr>
              </tbody>
            </table>

            <p>
              {' '}
              {t('where_budgero_relies_on_legitimate_interest')}{' '}
              <EmailLink email="privacy@budgero.app" />.
            </p>

            <hr />

            <h2>{t('5_how_long_it_s_kept')}</h2>

            <table>
              <thead>
                <tr>
                  <th>{t('category')}</th>
                  <th>{t('retention')}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{t('account_data_email_account_id_preferences')}</td>
                  <td> {t('for_the_life_of_your_account')} </td>
                </tr>
                <tr>
                  <td>{t('encrypted_vault_data')}</td>
                  <td> {t('for_the_life_of_your_account_2')} </td>
                </tr>
                <tr>
                  <td>{t('billing_records_orders_invoices')}</td>
                  <td> {t('retained_as_required_by_applicable_tax')} </td>
                </tr>
                <tr>
                  <td>{t('service_email_send_open_bounce_metadata')}</td>
                  <td> {t('up_to_90_days_in_the')} </td>
                </tr>
                <tr>
                  <td>{t('analytics_events_app_server_website')}</td>
                  <td> {t('up_to_6_months_in_the')} </td>
                </tr>
                <tr>
                  <td>{t('product_analytics_person_profiles')}</td>
                  <td> {t('up_to_12_months_of_inactivity')} </td>
                </tr>
                <tr>
                  <td>{t('server_security_logs')}</td>
                  <td> {t('up_to_30_days_for_routine')} </td>
                </tr>
              </tbody>
            </table>

            <p> {t('when_you_delete_your_account_the')} </p>

            <hr />

            <h2>{t('6_who_it_s_shared_with')}</h2>
            <p>
              {' '}
              {t('personal_data_is')} <strong>{t('never_sold_or_rented')}</strong>
              {t('limited_personal_data_is_shared_with')}{' '}
            </p>

            <table>
              <thead>
                <tr>
                  <th>{t('provider')}</th>
                  <th>{t('role')}</th>
                  <th>{t('personal_data_shared')}</th>
                  <th>{t('region')}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <strong>{t('clerk')}</strong>
                  </td>
                  <td>{t('authentication_and_account_management')}</td>
                  <td>{t('email_password_hashed_account_id')}</td>
                  <td>{t('eu_residency_configured')}</td>
                </tr>
                <tr>
                  <td>
                    <strong>{t('posthog_cloud_eu')}</strong>
                  </td>
                  <td>{t('product_analytics')}</td>
                  <td>{t('pseudonymous_events_and_error_reports_ip')}</td>
                  <td>EU</td>
                </tr>
                <tr>
                  <td>
                    <strong>{t('lemonsqueezy')}</strong>
                  </td>
                  <td>{t('payments_and_subscription_billing')}</td>
                  <td>{t('email_billing_address_plan_payment_instrument')}</td>
                  <td>{t('us_with_sccs')}</td>
                </tr>
                <tr>
                  <td>
                    <strong>{t('resend')}</strong>
                  </td>
                  <td>{t('transactional_email_delivery')}</td>
                  <td>{t('email_address_message_content_of_service')}</td>
                  <td>{t('eu_us_with_sccs')}</td>
                </tr>
                <tr>
                  <td>
                    <strong>{t('hosting_provider')}</strong>
                  </td>
                  <td>{t('application_hosting_and_server_logs')}</td>
                  <td>{t('all_data_above_transits_or_is')}</td>
                  <td>EU</td>
                </tr>
              </tbody>
            </table>

            <p> {t('budgero_may_also_disclose_personal_data')} </p>
            <ul>
              <li>
                <strong>{t('professional_advisers')}</strong>{' '}
                {t('lawyers_accountants_under_duties_of_confidential')}{' '}
              </li>
              <li>
                <strong>{t('law_enforcement_or_regulators')}</strong>{' '}
                {t('where_compelled_by_valid_legal_process')}{' '}
              </li>
            </ul>

            <hr />

            <h2>{t('7_international_transfers')}</h2>
            <p> {t('some_of_the_providers_in_6')} </p>
            <p>
              {' '}
              {t('for_provider_transfers_outside_the_eea_no_ads')}{' '}
              <strong>{t('standard_contractual_clauses_sccs_2021_version')}</strong>{' '}
              {t('and_equivalent_uk_addenda_where_applicable')}{' '}
            </p>

            <hr />

            <h2>{t('8_cookies_and_tracking')}</h2>
            <p>{t('budgero_uses_no_analytics_advertising_or')}</p>
            <ul>
              <li>
                <strong>{t('strictly_necessary')}</strong> {t('strictly_necessary_storage_desc')}
              </li>
              <li>
                <strong>{t('analytics')}</strong> {t('analytics_nothing_stored_desc')}
              </li>
            </ul>

            <hr />

            <h2>{t('9_how_data_is_secured')}</h2>
            <ul>
              <li>
                <strong>{t('end_to_end_encryption')}</strong>{' '}
                {t('for_vault_data_aes_256_with')}{' '}
              </li>
              <li>
                <strong>{copy('u_bd7f8feaa799')}</strong> {t('for_all_data_in_transit')}{' '}
              </li>
              <li>
                <strong>{t('encryption_at_rest')}</strong>{' '}
                {t('at_the_database_and_storage_layers')}{' '}
              </li>
              <li>
                <strong>{t('single_operator_access_controls')}</strong>{' '}
                {t('only_the_operator_has_administrative_access')}{' '}
              </li>
              <li>
                <strong>{t('vendor_due_diligence')}</strong>{' '}
                {t('when_choosing_each_provider_in_6')}{' '}
              </li>
              <li>
                <strong>{t('breach_response')}</strong> {t('if_a_personal_data_breach_occurs')}{' '}
              </li>
            </ul>
            <p>
              {' '}
              {t('important_caveat_zero_knowledge_means')}{' '}
              <strong>{t('your_vault_cannot_be_recovered_if')}</strong>{' '}
              {t('store_it_somewhere_safe_a_password')}{' '}
            </p>

            <hr />

            <h2>{t('10_your_rights')}</h2>
            <p>{t('wherever_you_live_you_can')}</p>
            <ul>
              <li>
                <strong>{t('access')}</strong> {t('the_personal_data_budgero_holds_about')}{' '}
              </li>
              <li>
                <strong>{t('correct')}</strong> {t('inaccurate_personal_data_rectification')}{' '}
              </li>
              <li>
                <strong>{t('delete')}</strong> {t('your_account_and_associated_personal_data')}{' '}
              </li>
              <li>
                <strong>{t('export')}</strong> {t('your_data_in_a_portable_machine')}{' '}
              </li>
              <li>
                <strong>{t('restrict')}</strong> {t('processing_while_a_dispute_is_resolved')}{' '}
              </li>
              <li>
                <strong>{t('object')}</strong>{' '}
                {t('to_processing_based_on_legitimate_interest_incl')}{' '}
              </li>
              <li>
                <strong>{t('withdraw_consent')}</strong>{' '}
                {t('at_any_time_for_anything_processed_on_consent')}{' '}
              </li>
              <li>
                <strong>{t('not_be_subject_to_automated_decisions')}</strong>{' '}
                {t('that_produce_legal_or_similarly_significant')}{' '}
              </li>
            </ul>
            <p>
              {' '}
              {t('to_exercise_any_of_these_email')}{' '}
              <EmailLink email="privacy@budgero.app" className="font-bold" />{' '}
              {t('requests_will_be_answered_as_fast')} <strong>{t('30_days')}</strong>{' '}
              {t('as_required_by_gdpr_extendable_by')}{' '}
            </p>
            <p>
              {' '}
              {t('you_can_also')} <strong>{t('lodge_a_complaint_with_a_supervisory')}</strong>:
            </p>
            <ul>
              <li>
                {' '}
                {t('eu_eea_residents_with_the_data')}{' '}
                <a href="https://edpb.europa.eu" target="_blank" rel="noopener noreferrer">
                  https://edpb.europa.eu
                </a>
                .
              </li>
              <li>
                {' '}
                {t('uk_residents_the_information_commissioner_s')}{' '}
                <a href="https://ico.org.uk" target="_blank" rel="noopener noreferrer">
                  https://ico.org.uk
                </a>
                .
              </li>
            </ul>

            <hr />

            <h2>{t('11_california_residents_ccpa_cpra_notice')}</h2>
            <p> {t('if_you_re_a_california_resident')} </p>
            <p>
              <strong>{t('categories_of_personal_information_collected')}</strong>{' '}
              {t('mapped_to_the_ccpa_categories_identifiers')}{' '}
            </p>
            <p>
              <strong>{t('sources')}</strong> {t('directly_from_you_from_your_device')}{' '}
            </p>
            <p>
              <strong>{t('disclosure_for_a_business_purpose')}</strong>{' '}
              {t('only_to_the_service_providers_in')}{' '}
            </p>
            <p>
              <strong>{t('sale_or_sharing_of_personal_information')}</strong>{' '}
              <strong>{t('personal_information_is_not_sold_or')}</strong>{' '}
              {t('as_those_terms_are_defined_in_no_ads')}{' '}
            </p>
            <p>
              {' '}
              {t('because_nothing_is_sold_or_shared')} <EmailLink email="privacy@budgero.app" />.
            </p>
            <p> {t('sensitive_personal_information_is_not_used')} </p>
            <p>{t('you_will_not_be_discriminated_against')}</p>

            <hr />

            <h2>{t('12_children_s_privacy')}</h2>
            <p>
              {' '}
              {t('budgero_is_not_directed_to_and')} <EmailLink email="privacy@budgero.app" />{' '}
              {t('and_it_will_be_deleted')}{' '}
            </p>

            <hr />

            <h2>{t('13_changes_to_this_policy')}</h2>
            <p> {t('this_policy_may_be_updated_as')} </p>

            <hr />

            <h2>{t('14_contact')}</h2>
            <ul>
              <li>
                {' '}
                {t('privacy_questions_and_rights_requests')}{' '}
                <EmailLink email="privacy@budgero.app" className="font-bold" />
              </li>
              <li>
                {' '}
                {t('general_support')} <EmailLink email="hello@budgero.app" className="font-bold" />
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
