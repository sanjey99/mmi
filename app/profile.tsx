import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, TextInput,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../src/stores/authStore';
import { Card } from '../src/components/ui/Card';
import { Button } from '../src/components/ui/Button';
import { colors, text, layout } from '../src/theme';

const UK_UNIVERSITIES = [
  'Oxford', 'Cambridge', 'UCL', 'Imperial', "King's",
  'Edinburgh', 'Manchester', 'Bristol', 'Sheffield', 'Leeds',
  'Nottingham', 'Birmingham', 'Newcastle', 'Southampton', 'Cardiff',
];

export default function ProfileScreen() {
  const { profile, updateProfile, signOut } = useAuthStore();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(profile?.full_name ?? '');
  const [university, setUniversity] = useState(profile?.university_target ?? '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateProfile({ full_name: name.trim(), university_target: university });
      setEditing(false);
    } catch (e: any) {
      Alert.alert('Save failed', e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = () => {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out', style: 'destructive', onPress: async () => {
          await signOut();
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  if (!profile) return null;

  // Generate avatar initials
  const initials = profile.full_name
    .split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?';

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>PROFILE</Text>
        <TouchableOpacity onPress={() => setEditing(!editing)}>
          <Text style={styles.editText}>{editing ? 'Cancel' : 'Edit'}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* Avatar */}
        <View style={styles.avatarSection}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          {editing ? (
            <TextInput
              style={styles.nameInput}
              value={name}
              onChangeText={setName}
              placeholder="Your full name"
              placeholderTextColor={colors.neutral[300]}
            />
          ) : (
            <Text style={styles.profileName}>{profile.full_name}</Text>
          )}
          <Text style={styles.profileEmail}>
            {/* Email shown from auth — profile doesn't store email */}
            Member since {new Date(profile.created_at).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
          </Text>
        </View>

        {/* Stats */}
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statVal}>{profile.streak_current}</Text>
            <Text style={styles.statLabel}>Day Streak</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statBox}>
            <Text style={styles.statVal}>{profile.streak_longest}</Text>
            <Text style={styles.statLabel}>Best Streak</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statBox}>
            <Text style={styles.statVal}>{profile.daily_goal}</Text>
            <Text style={styles.statLabel}>Daily Goal</Text>
          </View>
        </View>

        {/* Target university */}
        <Text style={styles.sectionLabel}>TARGET UNIVERSITY</Text>
        {editing ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.uniScroll}>
            <View style={styles.uniChips}>
              {UK_UNIVERSITIES.map(u => (
                <TouchableOpacity
                  key={u}
                  onPress={() => setUniversity(u)}
                  style={[styles.uniChip, university === u && styles.uniChipActive]}
                >
                  <Text style={[styles.uniChipText, university === u && styles.uniChipTextActive]}>{u}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        ) : (
          <Card style={styles.uniCard}>
            <Text style={styles.uniValue}>
              {profile.university_target ?? 'Not set — tap Edit to choose your target university'}
            </Text>
          </Card>
        )}

        {editing && (
          <Button
            label={saving ? 'Saving...' : 'Save Changes'}
            onPress={handleSave}
            loading={saving}
            style={{ marginTop: 20 }}
          />
        )}

        {/* Admin panel link */}
        {profile.is_admin && (
          <>
            <Text style={styles.sectionLabel}>ADMIN</Text>
            <TouchableOpacity onPress={() => router.push('/admin')} activeOpacity={0.8}>
              <Card style={styles.adminRow} elevated>
                <Text style={styles.adminIcon}>🔧</Text>
                <Text style={styles.adminLabel}>Admin Panel</Text>
                <Text style={styles.chevron}>›</Text>
              </Card>
            </TouchableOpacity>
          </>
        )}

        {/* Sign out */}
        <Button
          label="Sign Out"
          onPress={handleSignOut}
          variant="danger"
          style={{ marginTop: 32 }}
        />

        <Text style={styles.version}>Interview Station · v0.1.0 · Phase 3</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.primary },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: layout.screenPaddingH, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: colors.bg.tertiary,
  },
  backText: { ...text.bodyMd, color: colors.teal[400], fontFamily: 'DMSans_500Medium', width: 60 },
  headerTitle: { ...text.labelMd, color: colors.primary[800] },
  editText: { ...text.bodyMd, color: colors.teal[400], fontFamily: 'DMSans_500Medium', width: 60, textAlign: 'right' },
  content: { paddingHorizontal: layout.screenPaddingH, paddingTop: 24, paddingBottom: 48 },

  avatarSection: { alignItems: 'center', marginBottom: 24 },
  avatar: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: colors.primary[800],
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
  },
  avatarText: { fontFamily: 'DMSans_700Bold', fontSize: 28, color: '#fff' },
  profileName: { fontFamily: 'DMSerifDisplay_400Regular', fontSize: 24, color: colors.primary[800] },
  profileEmail: { ...text.bodySm, color: colors.neutral[500], marginTop: 4 },
  nameInput: {
    ...text.headingMd,
    color: colors.primary[800],
    borderBottomWidth: 1.5, borderBottomColor: colors.teal[400],
    paddingVertical: 4, paddingHorizontal: 8, marginBottom: 4,
    textAlign: 'center',
  },

  statsRow: {
    flexDirection: 'row', backgroundColor: colors.bg.white,
    borderRadius: 16, padding: 16, marginBottom: 24,
    borderWidth: 1, borderColor: colors.bg.tertiary,
  },
  statBox: { flex: 1, alignItems: 'center' },
  statVal: { fontFamily: 'DMSerifDisplay_400Regular', fontSize: 28, color: colors.primary[800] },
  statLabel: { ...text.caption, color: colors.neutral[500], marginTop: 2 },
  statDivider: { width: 1, backgroundColor: colors.bg.tertiary, marginHorizontal: 8 },

  sectionLabel: { ...text.labelMd, color: colors.neutral[400], marginBottom: 10, marginTop: 8 },

  uniCard: { marginBottom: 8 },
  uniValue: { ...text.bodyMd, color: colors.primary[800] },
  uniScroll: { marginBottom: 8 },
  uniChips: { flexDirection: 'row', gap: 8, paddingVertical: 4, paddingRight: 16 },
  uniChip: {
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 99,
    borderWidth: 1.5, borderColor: colors.bg.tertiary,
    backgroundColor: colors.bg.white,
  },
  uniChipActive: { backgroundColor: colors.teal[400], borderColor: colors.teal[400] },
  uniChipText: { ...text.bodySm, color: colors.neutral[700] },
  uniChipTextActive: { color: '#fff', fontFamily: 'DMSans_500Medium' },

  adminRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  adminIcon: { fontSize: 22 },
  adminLabel: { ...text.headingSm, color: colors.primary[800], flex: 1 },
  chevron: { ...text.headingMd, color: colors.neutral[300], fontSize: 22 },

  version: { ...text.caption, color: colors.neutral[300], textAlign: 'center', marginTop: 24 },
});
