import { router } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { navigateBackOr } from '../../lib/navigation';
import { colors, layout, text } from '../../theme';

export interface LegalSection {
  title: string;
  paragraphs: readonly string[];
  points?: readonly string[];
}

interface LegalDocumentProps {
  code: string;
  title: string;
  effectiveDate: string;
  reviewNotice: string;
  sections: readonly LegalSection[];
}

export function LegalDocument({
  code,
  title,
  effectiveDate,
  reviewNotice,
  sections,
}: LegalDocumentProps) {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigateBackOr(router, '/')}
          accessibilityRole="button"
        >
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{code}</Text>
        <View style={styles.headerSpacer} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>INTERVIEW STATION · CLOSED PREVIEW</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.effective}>EFFECTIVE {effectiveDate.toUpperCase()}</Text>
        <View style={styles.reviewNotice}>
          <Text style={styles.reviewLabel}>REVIEW STATUS</Text>
          <Text style={styles.reviewText}>{reviewNotice}</Text>
        </View>

        {sections.map((section, index) => (
          <View key={section.title} style={styles.section}>
            <View style={styles.sectionHeading}>
              <Text style={styles.sectionNumber}>{String(index + 1).padStart(2, '0')}</Text>
              <Text style={styles.sectionTitle}>{section.title}</Text>
            </View>
            {section.paragraphs.map(paragraph => (
              <Text key={paragraph} style={styles.body}>{paragraph}</Text>
            ))}
            {section.points?.map(point => (
              <View key={point} style={styles.pointRow}>
                <Text style={styles.pointMarker}>—</Text>
                <Text style={styles.pointText}>{point}</Text>
              </View>
            ))}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.primary },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.screenPaddingH,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.primary[800],
  },
  backText: { ...text.labelMd, color: colors.primary[800], minWidth: 96, textTransform: 'uppercase' },
  headerTitle: { ...text.labelMd, color: colors.primary[800] },
  headerSpacer: { width: 96 },
  content: {
    width: '100%',
    maxWidth: 840,
    alignSelf: 'center',
    paddingHorizontal: layout.screenPaddingH,
    paddingTop: 32,
    paddingBottom: 64,
  },
  eyebrow: { ...text.labelMd, color: colors.neutral[500], marginBottom: 6 },
  title: { ...text.displayLg, color: colors.primary[900] },
  effective: { ...text.labelMd, color: colors.neutral[500], marginTop: 8 },
  reviewNotice: {
    borderTopWidth: 8,
    borderWidth: 1,
    borderColor: colors.primary[800],
    backgroundColor: colors.bg.white,
    padding: 16,
    marginVertical: 24,
  },
  reviewLabel: { ...text.labelMd, color: colors.primary[800], marginBottom: 5 },
  reviewText: { ...text.bodyMd, color: colors.neutral[600], lineHeight: 22 },
  section: { borderTopWidth: 1, borderTopColor: colors.primary[800], paddingTop: 18, marginTop: 12, marginBottom: 18 },
  sectionHeading: { flexDirection: 'row', alignItems: 'baseline', gap: 12, marginBottom: 10 },
  sectionNumber: { ...text.headingSm, color: colors.teal[600], fontVariant: ['tabular-nums'] },
  sectionTitle: { ...text.headingLg, color: colors.primary[900], flex: 1 },
  body: { ...text.bodyMd, color: colors.neutral[700], lineHeight: 24, marginBottom: 10, maxWidth: 720 },
  pointRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 8, maxWidth: 720 },
  pointMarker: { ...text.bodyMd, color: colors.teal[600] },
  pointText: { ...text.bodyMd, color: colors.neutral[700], lineHeight: 23, flex: 1 },
});
