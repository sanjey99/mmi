/**
 * AI Configuration Screen — Admin only
 *
 * Allows admins to configure the AI provider used for answer scoring.
 * Supports:
 *   - anthropic  → Anthropic Messages API (api.anthropic.com)
 *   - openai     → OpenAI Chat API (api.openai.com)
 *   - openai_compatible → Any OpenAI-compatible endpoint (Groq, Together, Mistral, Ollama, etc.)
 *
 * Non-secret configuration is stored in `app_config`. The API key is
 * write-only: it is saved through an Edge Function and never returned here.
 */
import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../src/lib/supabase';
import { FloatingInput as Input } from '../../src/components/ui/Input';
import { Button } from '../../src/components/ui/Button';
import { Card } from '../../src/components/ui/Card';
import { ConfirmAction } from '../../src/components/feedback/ConfirmAction';
import { InlineNotice } from '../../src/components/feedback/InlineNotice';
import { navigateBackOr } from '../../src/lib/navigation';
import { colors, text, layout } from '../../src/theme';
import type { AIProvider } from '../../src/types';

const PROVIDERS: { id: AIProvider; label: string; desc: string }[] = [
  { id: 'anthropic', label: 'Anthropic (Claude)', desc: 'Claude 3.5 Sonnet, Haiku, etc.' },
  { id: 'openai', label: 'OpenAI', desc: 'GPT-4o, GPT-4 Turbo, etc.' },
  { id: 'openai_compatible', label: 'OpenAI-Compatible', desc: 'Groq, Together, Mistral, Ollama, etc.' },
];

const DEFAULT_MODELS: Record<AIProvider, string> = {
  anthropic: 'claude-3-5-haiku-20241022',
  openai: 'gpt-4o-mini',
  openai_compatible: 'llama-3.1-8b-instant',
};

export default function AIConfigScreen() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [provider, setProvider] = useState<AIProvider>('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [isConfigured, setIsConfigured] = useState(false);
  const [model, setModel] = useState(DEFAULT_MODELS.anthropic);
  const [baseUrl, setBaseUrl] = useState('');
  const [confirmingSave, setConfirmingSave] = useState(false);
  const [notice, setNotice] = useState<{
    title: string;
    message: string;
    tone: 'info' | 'success' | 'warning' | 'error';
  } | null>(null);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const keys = ['ai_provider', 'ai_model', 'ai_base_url'];
      const { data, error } = await supabase
        .from('app_config')
        .select('key, value')
        .in('key', keys);
      if (error) throw error;

      const map = Object.fromEntries((data ?? []).map((r: any) => [r.key, r.value]));
      if (map.ai_provider) setProvider(map.ai_provider as AIProvider);
      if (map.ai_model) setModel(map.ai_model);
      if (map.ai_base_url) setBaseUrl(map.ai_base_url);

      const { data: keyStatus, error: keyStatusError } = await supabase.functions.invoke<{ configured: boolean }>(
        'manage-ai-key',
        { body: { action: 'status' } },
      );
      if (keyStatusError) throw keyStatusError;
      setIsConfigured(Boolean(keyStatus?.configured));
    } catch {
      setNotice({ title: 'Configuration not loaded', message: 'Check admin access, deployed functions, and your connection.', tone: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleProviderChange = (p: AIProvider) => {
    setProvider(p);
    setModel(DEFAULT_MODELS[p]);
    if (p !== 'openai_compatible') setBaseUrl('');
  };

  const handleSave = async () => {
    if (!apiKey.trim() && !isConfigured) {
      setNotice({ title: 'API key required', message: 'Enter a key before saving the initial scoring configuration.', tone: 'error' });
      return;
    }
    if (!model.trim()) {
      setNotice({ title: 'Model required', message: 'Enter the exact provider model name.', tone: 'error' });
      return;
    }
    if (provider === 'openai_compatible' && !baseUrl.trim()) {
      setNotice({ title: 'Base URL required', message: 'OpenAI-compatible providers need an approved HTTPS base URL.', tone: 'error' });
      return;
    }

    setNotice(null);
    setConfirmingSave(true);
  };

  const confirmSave = async () => {
    setSaving(true);
    try {
      const upserts = [
        { key: 'ai_provider', value: provider },
        { key: 'ai_model', value: model.trim() },
        { key: 'ai_base_url', value: baseUrl.trim() || null },
      ];

      const { error } = await supabase
        .from('app_config')
        .upsert(upserts, { onConflict: 'key' });

      if (error) throw error;

      if (apiKey.trim()) {
        const { data, error: keyError } = await supabase.functions.invoke<{ configured: boolean }>(
          'manage-ai-key',
          { body: { apiKey: apiKey.trim() } },
        );
        if (keyError) throw keyError;
        setIsConfigured(Boolean(data?.configured));
        setApiKey('');
      }

      setConfirmingSave(false);
      setNotice({ title: 'Configuration saved', message: 'The selected provider and model are now active.', tone: 'success' });
    } catch {
      setConfirmingSave(false);
      setNotice({ title: 'Configuration not saved', message: 'No success was confirmed. Check the Edge function and admin access, then retry.', tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleTestConfig = async () => {
    if (!isConfigured) {
      setNotice({ title: 'Configuration incomplete', message: 'Enter and save an API key before testing scoring.', tone: 'error' });
      return;
    }
    router.push('/(tabs)/practice');
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <ActivityIndicator style={{ flex: 1 }} color={colors.teal[400]} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigateBackOr(router, '/admin')} accessibilityRole="button">
          <Text style={styles.backText}>Back to admin</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>AI CONFIG</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        <Text style={styles.title}>AI Provider</Text>
        <Text style={styles.sub}>Configure which AI powers answer scoring.</Text>

        {notice ? <InlineNotice {...notice} /> : null}
        {confirmingSave ? (
          <ConfirmAction
            title="Apply this scoring configuration?"
            message={apiKey.trim()
              ? `This updates provider/model settings and replaces the stored ${provider} API key. The key will not be shown again.`
              : `This updates provider/model settings and keeps the existing ${provider} API key.`}
            confirmLabel="Apply configuration"
            busy={saving}
            onConfirm={confirmSave}
            onCancel={() => setConfirmingSave(false)}
          />
        ) : null}

        {/* Provider selector */}
        <Text style={styles.fieldLabel}>PROVIDER</Text>
        <View style={styles.providerList}>
          {PROVIDERS.map(p => (
            <TouchableOpacity
              key={p.id}
              onPress={() => handleProviderChange(p.id)}
              style={[styles.providerOption, provider === p.id && styles.providerOptionSelected]}
              activeOpacity={0.8}
            >
              <View style={[styles.radio, provider === p.id && styles.radioSelected]}>
                {provider === p.id && <View style={styles.radioDot} />}
              </View>
              <View>
                <Text style={[styles.providerLabel, provider === p.id && styles.providerLabelSelected]}>
                  {p.label}
                </Text>
                <Text style={styles.providerDesc}>{p.desc}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* API Key */}
        <Text style={styles.fieldLabel}>API KEY</Text>
        <Input
          label="API Key"
          value={apiKey}
          onChangeText={setApiKey}
          placeholder={
            provider === 'anthropic' ? 'sk-ant-...' :
            provider === 'openai' ? 'sk-...' :
            'Your API key'
          }
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Text style={styles.keyHint}>
          {isConfigured
            ? 'An API key is configured. Enter a value only to replace it.'
            : 'No API key is configured yet.'}
        </Text>

        {/* Model */}
        <Text style={styles.fieldLabel}>MODEL</Text>
        <Input
          label="Model"
          value={model}
          onChangeText={setModel}
          placeholder={DEFAULT_MODELS[provider]}
          autoCapitalize="none"
          autoCorrect={false}
        />

        {/* Base URL (only for openai_compatible) */}
        {provider === 'openai_compatible' && (
          <>
            <Text style={styles.fieldLabel}>BASE URL</Text>
            <Input
              label="Base URL"
              value={baseUrl}
              onChangeText={setBaseUrl}
              placeholder="https://api.groq.com/openai/v1"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            {baseUrl.startsWith('http://') &&
              !baseUrl.includes('localhost') &&
              !baseUrl.includes('127.0.0.1') && (
              <Text style={styles.httpsWarning}>
                Non-HTTPS remote providers are blocked in production. Use an approved HTTPS endpoint.
              </Text>
            )}
          </>
        )}

        {/* Examples */}
        <Card variant="teal" style={styles.examplesCard}>
          <Text style={styles.examplesTitle}>Common OpenAI-compatible providers</Text>
          {[
            { name: 'Groq', url: 'https://api.groq.com/openai/v1', models: 'llama-3.1-8b-instant, mixtral-8x7b' },
            { name: 'Together AI', url: 'https://api.together.xyz/v1', models: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo' },
            { name: 'Mistral', url: 'https://api.mistral.ai/v1', models: 'mistral-small-latest' },
            { name: 'Ollama (local)', url: 'http://localhost:11434/v1', models: 'llama3.2, phi3.5' },
          ].map(e => (
            <View key={e.name} style={styles.exampleRow}>
              <Text style={styles.exampleName}>{e.name}</Text>
              <Text style={styles.exampleUrl}>{e.url}</Text>
              <Text style={styles.exampleModels}>{e.models}</Text>
            </View>
          ))}
        </Card>

        <Button label={saving ? 'Saving...' : 'Save Configuration'} onPress={handleSave} loading={saving} style={{ marginTop: 8 }} />
        <Button label="Open practice to test" onPress={handleTestConfig} variant="secondary" style={{ marginTop: 12 }} />

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
  backText: { ...text.labelMd, color: colors.primary[800], minWidth: 104, textTransform: 'uppercase' },
  headerTitle: { ...text.labelMd, color: colors.primary[800] },
  content: { paddingHorizontal: layout.screenPaddingH, paddingTop: 20, paddingBottom: 48 },

  title: { ...text.displayLg, color: colors.primary[800], marginBottom: 4 },
  sub: { ...text.bodyMd, color: colors.neutral[500], marginBottom: 24 },
  fieldLabel: { ...text.labelMd, color: colors.neutral[500], marginBottom: 8, marginTop: 16 },

  providerList: { gap: 10, marginBottom: 8 },
  providerOption: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, borderRadius: 2,
    borderWidth: 1.5, borderColor: colors.bg.tertiary,
    backgroundColor: colors.bg.white,
  },
  providerOptionSelected: {
    borderColor: colors.teal[400],
    backgroundColor: `${colors.teal[400]}0A`,
  },
  radio: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 2, borderColor: colors.neutral[300],
    alignItems: 'center', justifyContent: 'center',
  },
  radioSelected: { borderColor: colors.teal[400] },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.teal[400] },
  providerLabel: { ...text.headingSm, color: colors.primary[800] },
  providerLabelSelected: { color: colors.teal[600] },
  providerDesc: { ...text.caption, color: colors.neutral[500], marginTop: 2 },

  httpsWarning: { ...text.bodySm, color: '#B45309', marginTop: 6 },
  keyHint: { ...text.caption, color: colors.neutral[500], marginTop: 6 },
  examplesCard: { marginTop: 20, marginBottom: 8 },
  examplesTitle: { ...text.headingSm, color: colors.teal[600], marginBottom: 12 },
  exampleRow: { marginBottom: 10 },
  exampleName: { ...text.bodyMd, color: colors.primary[800], fontFamily: 'SourceSans3_600SemiBold' },
  exampleUrl: { ...text.caption, color: colors.neutral[500] },
  exampleModels: { ...text.caption, color: colors.neutral[400] },
});
