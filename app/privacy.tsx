import React from 'react';
import { LegalDocument, type LegalSection } from '../src/components/legal/LegalDocument';

const SECTIONS: readonly LegalSection[] = [
  {
    title: 'Your privacy at a glance',
    paragraphs: [
      'Interview Station is for university applicants, including students under 18. We use the same private account settings for everyone and do not ask for your date of birth. Other candidates cannot see your answers or progress. We do not use advertising trackers, sell your data, or publish a public candidate profile.',
      'We need your email to protect your account. You can practise with made-up examples and type instead of using the microphone. Your submitted answer goes to an AI provider for feedback. We keep your scores, explanations, and short answer excerpts; the full transcript is deleted after scoring or within 24 hours if scoring is unresolved. Never include real patient information or anything sensitive.',
      'AI feedback can be wrong and does not decide your university admission. If you are unsure about sharing something, leave it out and ask a parent, teacher, or trusted adult. You can ask the founding team for help with your information or to close your account.',
    ],
  },
  {
    title: 'Who operates this preview',
    paragraphs: [
      'The Interview Station founding team operates this interview-practice beta and decides how beta data is used. Accounts may be invited or created through public registration when it is available. The legal operating person or company has not yet been finalized in this draft. Contact interviewstation.admin@gmail.com for support, privacy questions, or requests about your information.',
      'This draft notice describes the current preview data flows. The operator identity and external-test scope require confirmation and qualified review before outside testing; preparing the notice does not complete that review.',
    ],
  },
  {
    title: 'Information we collect',
    paragraphs: ['We collect only information used to operate, secure, and evaluate the preview.'],
    points: [
      'Account and profile data: email address, an optional profile name, target university, entry year, onboarding status, role, and account timestamps. Registration does not request your date of birth or a real name.',
      'Practice data: selected question and category, session timing and status, AI-generated rubric scores, per-criterion justifications, supporting answer excerpts of up to 300 characters per criterion, and progress summaries. Our application and database never store raw MMI audio; we delete the full MMI transcript immediately after successful scoring and within 24 hours when unresolved. Supporting excerpts remain with your feedback.',
      'Content operations: questions, guidance notes, tags, draft or published status, and configuration actions submitted by authorized administrators.',
      'Tester reports: category, severity, screen, message, app version, reply permission, and account ID. The review API hides the account ID when reply permission is off.',
      'Technical records: security, authentication, delivery, and error metadata processed by our hosting and backend providers. The app does not intentionally attach screenshots, browser logs, access tokens, answers, or transcripts to tester reports.',
      'Runtime monitoring: for signed-in accounts, we count unexpected app errors using the account ID, hour, fixed error category, and broad screen area. These counters do not contain error messages, stack traces, URLs, query strings, invitation links, answers, or recordings. Administrators see aggregate counts. Independent GitHub health checks receive service health states only, without candidate data.',
      'Feedback allowances: private records count each account’s daily feedback use and keep response IDs with the time each answer first entered scoring. No answer text is added to these records. The allowance screen receives only your own remaining counts, reset time, and availability; it cannot request another account’s counts.',
    ],
  },
  {
    title: 'How and why we use information',
    paragraphs: [
      'We use account and practice information to provide interview practice, authenticate users, restore sessions, produce feedback, show progress, operate the question desk, prevent abuse, diagnose failures, and improve the product.',
      'The provisional legal bases are providing the requested service where applicable and the founding team’s legitimate interests in operating, securing, and evaluating the product. These bases and how they apply to younger users require qualified review. Reading this notice is not consent to optional marketing or tracking. Reply permission controls whether an administrator receives your account ID with a tester report.',
      'AI scores are formative and do not produce legal or similarly significant decisions about you. They are not used to decide medical treatment, employment, education admission, credit, or access to a public service.',
    ],
  },
  {
    title: 'Service providers and AI processing',
    paragraphs: [
      'Vercel serves the static web application. Supabase provides authentication, database, and Edge Function services. When scoring is enabled, the server sends the selected prompt and submitted answer to the AI provider configured by the founding team. Browser speech and AI providers may process data under their own terms and retention practices. Authorized founders may review product feedback and support records.',
      'Google Gmail delivers account invitations, confirmation messages, and password-reset emails through the dedicated Interview Station mailbox. Google processes the recipient email address, message content, account-action link, and delivery metadata. Sent-mail copies may remain in that mailbox. If you email support, your message and any information you include are also handled by Gmail and the team members with access to the mailbox. Do not send passwords, sign-in links, or real patient details to support.',
      'The main app and administrator-only GPT-5.5 comparison app use the same Supabase project, accounts, and practice-history data. Tester accounts do not gain administrator privileges or access to another account’s private practice records. The configured scoring provider and its handling settings must be confirmed for the external test.',
      'These providers may process data in countries outside your own. Contractual safeguards, project regions, provider settings, and current subprocessor lists must be confirmed before a wider round. We do not sell preview personal data or use it for advertising.',
    ],
  },
  {
    title: 'Browser storage and security',
    paragraphs: [
      'On the web, the authentication session is stored in browser session storage so it can survive a refresh in the same tab and is not intentionally kept as a long-lived local-storage login. Explicit sign-out removes the session.',
      'We use authorization checks, row-level security, fixed server response shapes, rate limits, and server-owned scoring controls. No internet service is risk-free; report suspected unauthorized access to interviewstation.admin@gmail.com and avoid entering real patient data.',
    ],
  },
  {
    title: 'Retention and your choices',
    paragraphs: [
      'The runtime-error counters are retained for seven full UTC days plus the current day, up to eight days while the daily cleanup is healthy. Aggregate activity and cost views use existing account and practice records; we do not add advertising trackers or session replay.',
      'Daily feedback-use records and first-admission response IDs and timestamps are kept for seven full UTC days plus the current day, up to eight days while the daily cleanup is healthy. They enforce fair-use limits and protect the shared service from excess spending. They do not add answer text or make your records public.',
      'Account-email copies and support correspondence in Gmail have a separate retention policy from practice transcripts. That mailbox retention period and who may access it still require approval before wider public access. Expiry of an account-action link does not delete the email copy.',
      'Structured practice outcomes, bounded supporting answer excerpts, and scoring justifications are kept while needed to provide your practice history, investigate issues, evaluate the product, and meet applicable obligations. Our application and database delete the full MMI transcript immediately after successful scoring and within 24 hours when unresolved; raw MMI audio is never stored by us. Supporting excerpts remain with your feedback and may include a complete short answer. External speech and AI providers may retain or process data under their own terms. Exact retention periods for other records still require approval before wider public access.',
      'Ask the founding team to access, correct, export, restrict, object to use of, or delete information associated with your account. The available rights depend on the applicable law and legal basis. You may also raise a concern with the relevant data-protection authority; UK participants can contact the Information Commissioner’s Office.',
    ],
  },
  {
    title: 'Scope and changes',
    paragraphs: [
      'This beta is being prepared for UK pre-university applicants, including students under 18, with public registration as well as invitations. We apply the same privacy defaults to all accounts rather than collect age information. A children’s data protection impact assessment and review of the operator, contact, providers, legal bases, and retention decisions remain launch tasks. We will explain material changes in the app or through the working contact channel.',
    ],
  },
];

export default function PrivacyScreen() {
  return (
    <LegalDocument
      code="PRIVACY / 03"
      title="Privacy notice"
      effectiveDate="21 October 2026"
      reviewNotice="Draft updated for UK pre-university applicants, including students under 18, and public registration. The support/privacy contact is interviewstation.admin@gmail.com. Controller identity, legal bases, international-transfer safeguards, retention periods, and children's data protection assessment still require qualified review."
      sections={SECTIONS}
    />
  );
}
