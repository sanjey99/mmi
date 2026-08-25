import React from 'react';
import { LegalDocument, type LegalSection } from '../src/components/legal/LegalDocument';

const SECTIONS: readonly LegalSection[] = [
  {
    title: 'Who operates this preview',
    paragraphs: [
      'The Interview Station founding team operates this closed preview and decides how preview data is used. Contact the team through the email or messaging channel used for your invitation to ask a privacy question or exercise a data right.',
      'This notice covers the invite-only web preview. It will be reviewed and replaced as needed before a wider closed round or public launch.',
    ],
  },
  {
    title: 'Information we collect',
    paragraphs: ['We collect only information used to operate, secure, and evaluate the preview.'],
    points: [
      'Account and profile data: email address, name, target university, entry year, onboarding status, role, and account timestamps.',
      'Practice data: selected question and category, written answer, session timing and status, AI-generated scores and feedback, and progress summaries.',
      'Content operations: questions, guidance notes, tags, draft or published status, and configuration actions submitted by authorized administrators.',
      'Partner reports: category, severity, screen, message, app version, reply permission, and account ID. The review API hides the account ID when reply permission is off.',
      'Technical records: security, authentication, delivery, and error metadata processed by our hosting and backend providers. The app does not intentionally attach screenshots, browser logs, access tokens, answers, or transcripts to partner reports.',
    ],
  },
  {
    title: 'How and why we use information',
    paragraphs: [
      'We use account and practice information to provide the requested preview, authenticate invited users, restore sessions, produce feedback, show progress, operate the question desk, prevent abuse, diagnose failures, and improve the product.',
      'For this invited evaluation, the provisional legal bases are performance of the preview arrangement where applicable and the founding team’s legitimate interests in operating, securing, and evaluating the product. Reply permission controls whether an administrator receives your account ID with a partner report. These bases require legal confirmation before an external round.',
      'AI scores are formative and do not produce legal or similarly significant decisions about you. They are not used to decide medical treatment, employment, education admission, credit, or access to a public service.',
    ],
  },
  {
    title: 'Service providers and AI processing',
    paragraphs: [
      'Vercel serves the static web application. Supabase provides authentication, database, and Edge Function services. When scoring is enabled, the server sends the selected prompt and submitted answer to the AI provider configured by the founding team. Authorized founders may review product feedback and support records.',
      'These providers may process data in countries outside your own. Contractual safeguards, project regions, provider settings, and current subprocessor lists must be confirmed before a wider round. We do not sell preview personal data or use it for advertising.',
    ],
  },
  {
    title: 'Browser storage and security',
    paragraphs: [
      'On the web, the authentication session is stored in browser session storage so it can survive a refresh in the same tab and is not intentionally kept as a long-lived local-storage login. Explicit sign-out removes the session.',
      'We use authorization checks, row-level security, fixed server response shapes, rate limits, and server-owned scoring controls. No internet service is risk-free; report suspected unauthorized access through the invitation channel and avoid entering real patient data.',
    ],
  },
  {
    title: 'Retention and your choices',
    paragraphs: [
      'Preview records are kept while they are needed to operate the invited test, investigate issues, evaluate the product, and meet applicable obligations. No automated deletion schedule is enabled in the current preview. Exact production retention periods must be approved before the approximately 100-person round.',
      'Ask the founding team to access, correct, export, restrict, object to use of, or delete information associated with your invited account. The available rights depend on the applicable law and legal basis. You may also raise a concern with the relevant data-protection authority; UK participants can contact the Information Commissioner’s Office.',
    ],
  },
  {
    title: 'Scope and changes',
    paragraphs: [
      'This preview is intended for invited adult cofounders and partners, not children or public signup. We will update this notice when the product, providers, purposes, or retention decisions change and communicate material preview changes through the invitation channel.',
    ],
  },
];

export default function PrivacyScreen() {
  return (
    <LegalDocument
      code="PRIVACY / 02"
      title="Privacy notice"
      effectiveDate="25 August 2026"
      reviewNotice="Operational preview notice based on the current data flows. The controller identity, contact, legal bases, international-transfer safeguards, and exact retention periods require qualified legal review before external testing."
      sections={SECTIONS}
    />
  );
}
