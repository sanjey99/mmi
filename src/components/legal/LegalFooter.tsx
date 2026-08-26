import { router } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, text } from '../../theme';

export function LegalFooter() {
  return (
    <View style={styles.footer}>
      <Text style={styles.notice}>CLOSED PREVIEW · DOCUMENTS REQUIRE LEGAL REVIEW BEFORE AN EXTERNAL ROUND</Text>
      <View style={styles.links}>
        <TouchableOpacity onPress={() => router.push('/terms')} accessibilityRole="link">
          <Text style={styles.link}>Terms</Text>
        </TouchableOpacity>
        <Text style={styles.divider}>/</Text>
        <TouchableOpacity onPress={() => router.push('/privacy')} accessibilityRole="link">
          <Text style={styles.link}>Privacy</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.neutral[300],
    marginTop: 24,
    paddingTop: 14,
    gap: 8,
  },
  notice: { ...text.caption, color: colors.neutral[500], lineHeight: 18 },
  links: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  link: { ...text.labelMd, color: colors.primary[800], textDecorationLine: 'underline' },
  divider: { ...text.labelMd, color: colors.neutral[400] },
});
