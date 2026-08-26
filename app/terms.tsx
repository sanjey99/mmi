import React from 'react';
import { LegalDocument, type LegalSection } from '../src/components/legal/LegalDocument';

const SECTIONS: readonly LegalSection[] = [
  {
    title: 'Closed-preview terms',
    paragraphs: [
      'These terms govern the invitation-only Interview Station cofounder preview. By using the preview, you agree to follow these terms and the linked Privacy Notice. If you do not agree, do not use the preview.',
      'Access is provided by the Interview Station founding team for product evaluation. Contact the team through the same email or messaging channel used for your invitation if you have a question about these terms.',
    ],
  },
  {
    title: 'Access and account security',
    paragraphs: [
      'You may use only the account assigned to you. Keep the credentials private, sign out on shared devices, and notify the founding team if you believe the account has been accessed by someone else.',
      'The founding team may suspend access to protect the preview, investigate misuse, contain a security issue, or end the testing period.',
    ],
  },
  {
    title: 'Acceptable use',
    paragraphs: ['Use the preview only for interview-practice testing and constructive product evaluation.'],
    points: [
      'Use synthetic examples. Do not enter real patient information, confidential workplace information, or another person’s sensitive data.',
      'Do not share access, scrape content, bypass authorization, disrupt the service, or run security testing unless the founding team has agreed the exact scope.',
      'Do not upload content you do not have permission to use. Question authors remain responsible for the accuracy, originality, and rights status of material they submit.',
    ],
  },
  {
    title: 'Medical and admissions disclaimer',
    paragraphs: [
      'Interview Station is a formative practice tool. It does not provide medical advice, clinical supervision, professional certification, or a prediction or guarantee of admission.',
      'AI-generated scores and feedback may be incomplete or wrong. Check important clinical, ethical, legal, and admissions information against authoritative sources and qualified human guidance. Do not use the preview to make decisions about a real patient.',
    ],
  },
  {
    title: 'AI scoring and preview content',
    paragraphs: [
      'When scoring is enabled, the selected prompt and the answer you submit are sent through the Interview Station server to the configured AI provider. The server validates the response, but automation cannot make the feedback fully reliable.',
      'The preview interface, authored question bank, scoring format, and related materials belong to their respective rights holders. Your invitation does not grant a right to copy, redistribute, resell, or publicly publish them.',
    ],
  },
  {
    title: 'Availability and changes',
    paragraphs: [
      'This is an unfinished preview supplied without a service-level commitment. Features may be unavailable, reset, changed, or withdrawn. The team will use reasonable care but cannot promise uninterrupted operation or preservation of every preview record.',
      'To the extent permitted by applicable law, the founding team is not responsible for indirect loss arising from reliance on automated feedback or temporary preview unavailability. Nothing in these terms excludes a responsibility that cannot lawfully be excluded.',
    ],
  },
  {
    title: 'Ending access and raising concerns',
    paragraphs: [
      'You may stop using the preview at any time and ask the founding team to close your access or address a data request. These closed-preview terms may be updated when the scope or data handling changes; material changes will be communicated through the invitation channel.',
    ],
  },
];

export default function TermsScreen() {
  return (
    <LegalDocument
      code="TERMS / 01"
      title="Terms of use"
      effectiveDate="25 August 2026"
      reviewNotice="Operational draft for invited cofounders and partners. It describes the current preview but is not a substitute for review by qualified counsel before an external testing round."
      sections={SECTIONS}
    />
  );
}
