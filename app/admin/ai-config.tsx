import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { InlineNotice } from '../../src/components/feedback/InlineNotice';
import { ConfirmAction } from '../../src/components/feedback/ConfirmAction';
import { Button } from '../../src/components/ui/Button';
import { FloatingInput as Input } from '../../src/components/ui/Input';
import { createAdminMmiApi } from '../../src/features/adminMmi/api';
import type { AdminMmiProvider } from '../../src/features/adminMmi/types';
import { navigateBackOr } from '../../src/lib/navigation';
import { supabase } from '../../src/lib/supabase';
import { colors, layout, text } from '../../src/theme';

const api = createAdminMmiApi(supabase);
const models: Record<AdminMmiProvider, string> = { anthropic: 'claude-3-5-haiku-20241022', openai: 'gpt-4o-mini', openai_compatible: 'gpt-4o-mini' };
type Notice = { title: string; message: string; tone: 'success' | 'error' | 'info' };

export default function AIConfigScreen() {
  const [loading, setLoading] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [keySaving, setKeySaving] = useState(false);
  const [confirm, setConfirm] = useState<'settings' | 'replace' | 'clear' | null>(null);
  const [provider, setProvider] = useState<AdminMmiProvider>('anthropic');
  const [model, setModel] = useState(models.anthropic);
  const [baseUrl, setBaseUrl] = useState('');
  const [key, setKey] = useState('');
  const [configured, setConfigured] = useState(false);
  const [rates, setRates] = useState({ input: '0', cached: '0', output: '0' });
  const [settingsNotice, setSettingsNotice] = useState<Notice | null>(null);
  const [keyNotice, setKeyNotice] = useState<Notice | null>(null);

  useEffect(() => {
    void api.getAiConfig()
      .then((config) => { setProvider(config.provider); setModel(config.model); setBaseUrl(config.baseUrl ?? ''); setConfigured(config.isConfigured); setRates({ input: String(config.inputRatePerMillion), cached: String(config.cachedInputRatePerMillion), output: String(config.outputRatePerMillion) }); })
      .catch(() => setSettingsNotice({ title: 'Settings not loaded', message: 'Check administrator access and connection.', tone: 'error' }))
      .finally(() => setLoading(false));
  }, []);

  const settingsInput = () => ({ provider, model, baseUrl: baseUrl || null, inputRatePerMillion: Number(rates.input), cachedInputRatePerMillion: Number(rates.cached), outputRatePerMillion: Number(rates.output) });
  const requestSettingsSave = () => {
    const input = settingsInput();
    if (!model.trim() || (provider === 'openai_compatible' && !baseUrl.trim())) { setSettingsNotice({ title: 'Settings incomplete', message: 'A model and HTTPS-compatible base URL are required.', tone: 'error' }); return; }
    if (Object.values(input).some((value) => typeof value === 'number' && (!Number.isFinite(value) || value < 0))) { setSettingsNotice({ title: 'Rates are invalid', message: 'Use non-negative USD amounts per million tokens.', tone: 'error' }); return; }
    setConfirm('settings');
  };
  const saveSettings = async () => {
    setSettingsSaving(true);
    try { await api.saveAiConfig(settingsInput()); setSettingsNotice({ title: 'Settings saved', message: 'Provider, model, base URL, and rates apply to future calls only.', tone: 'success' }); }
    catch { setSettingsNotice({ title: 'Settings not saved', message: 'No settings change was confirmed. Check access and retry.', tone: 'error' }); }
    finally { setSettingsSaving(false); setConfirm(null); }
  };
  const requestReplaceKey = () => {
    if (!key.trim()) { setKeyNotice({ title: 'Replacement key required', message: 'Enter the write-only replacement key before confirming.', tone: 'error' }); return; }
    setConfirm('replace');
  };
  const replaceKey = async () => {
    setKeySaving(true);
    try {
      const { data, error } = await supabase.functions.invoke<{ configured: boolean }>('manage-ai-key', { body: { apiKey: key.trim() } });
      if (error || !data?.configured) throw new Error('key replacement not confirmed');
      setConfigured(true); setKey(''); setKeyNotice({ title: 'Key replaced', message: 'The new write-only key is configured for scoring.', tone: 'success' });
    } catch { setKeyNotice({ title: 'Key not replaced', message: 'No key replacement was confirmed. Settings were not changed.', tone: 'error' }); }
    finally { setKeySaving(false); setConfirm(null); }
  };
  const clearKey = async () => {
    setKeySaving(true);
    try {
      const { data, error } = await supabase.functions.invoke<{ configured: boolean }>('manage-ai-key', { body: { action: 'clear', confirm: true } });
      if (error || data?.configured !== false) throw new Error('key clear not confirmed');
      setConfigured(false); setKey(''); setKeyNotice({ title: 'Key cleared', message: 'No scoring key is configured.', tone: 'success' });
    } catch { setKeyNotice({ title: 'Key not cleared', message: 'No key clear was confirmed. Settings were not changed.', tone: 'error' }); }
    finally { setKeySaving(false); setConfirm(null); }
  };
  const confirmAction = () => confirm === 'settings' ? void saveSettings() : confirm === 'replace' ? void replaceKey() : void clearKey();
  const isConfigured = configured;
  const handleTestConfig = async () => {
    if (!isConfigured) {
      setKeyNotice({ title: 'Key required for scoring', message: 'Replace the write-only key before testing scoring.', tone: 'error' });
      return;
    }
    router.push('/(tabs)/practice');
  };

  if (loading) return <SafeAreaView style={styles.safe}><ActivityIndicator style={{ flex: 1 }} color={colors.teal[400]} /></SafeAreaView>;
  return <SafeAreaView style={styles.safe}><View style={styles.header}><TouchableOpacity onPress={() => navigateBackOr(router, '/admin')} accessibilityRole="button"><Text style={styles.back}>Back to admin</Text></TouchableOpacity><Text style={styles.headerTitle}>AI CONFIG</Text><View style={{ width: 104 }} /></View><ScrollView contentContainerStyle={styles.content}>
    {settingsNotice ? <InlineNotice {...settingsNotice} /> : null}{keyNotice ? <InlineNotice {...keyNotice} /> : null}
    {confirm ? <ConfirmAction title={confirm === 'settings' ? 'Save AI settings?' : confirm === 'replace' ? 'Replace the scoring key?' : 'Clear the scoring key?'} message={confirm === 'settings' ? 'Only provider, model, base URL, and rates will change. The write-only key is untouched.' : confirm === 'replace' ? 'Only the write-only key will change. Provider, model, base URL, and rates are untouched.' : 'This removes the active write-only key. Settings remain unchanged.'} confirmLabel={confirm === 'settings' ? 'Save settings' : confirm === 'replace' ? 'Replace key' : 'Clear key'} destructive={confirm === 'clear'} busy={settingsSaving || keySaving} onConfirm={confirmAction} onCancel={() => setConfirm(null)} /> : null}
    <Text style={styles.title}>AI configuration</Text><Text style={styles.sub}>Rates are USD per million tokens. Historical costs remain tied to the rate snapshot from each completed call.</Text>
    <Text style={styles.label}>PROVIDER</Text><View style={styles.options}>{(['anthropic', 'openai', 'openai_compatible'] as const).map((option) => <TouchableOpacity key={option} onPress={() => { setProvider(option); setModel(models[option]); if (option !== 'openai_compatible') setBaseUrl(''); }} style={[styles.option, provider === option && styles.selected]} accessibilityRole="radio" accessibilityState={{ selected: provider === option }}><Text style={styles.optionText}>{option.replace('_', ' ')}</Text></TouchableOpacity>)}</View>
    <Text style={styles.label}>MODEL</Text><Input label="Model" value={model} onChangeText={setModel} autoCapitalize="none" autoCorrect={false} />
    {provider === 'openai_compatible' ? <><Text style={styles.label}>HTTPS COMPATIBLE BASE URL</Text><Input label="Base URL" value={baseUrl} onChangeText={setBaseUrl} keyboardType="url" autoCapitalize="none" autoCorrect={false} /></> : null}
    <Text style={styles.label}>INPUT RATE · USD / 1M TOKENS</Text><Input label="Input rate" value={rates.input} onChangeText={(input) => setRates((value) => ({ ...value, input }))} keyboardType="decimal-pad" /><Text style={styles.label}>CACHED INPUT RATE · USD / 1M TOKENS</Text><Input label="Cached input rate" value={rates.cached} onChangeText={(cached) => setRates((value) => ({ ...value, cached }))} keyboardType="decimal-pad" /><Text style={styles.label}>OUTPUT RATE · USD / 1M TOKENS</Text><Input label="Output rate" value={rates.output} onChangeText={(output) => setRates((value) => ({ ...value, output }))} keyboardType="decimal-pad" />
    <Button label="Save AI settings" onPress={requestSettingsSave} loading={settingsSaving} style={{ marginTop: 8 }} />
    <Text style={styles.label}>WRITE-ONLY API KEY</Text><Input label="Replace API key" value={key} onChangeText={setKey} secureTextEntry autoCapitalize="none" autoCorrect={false} /><Text style={styles.hint}>{configured ? 'A key is configured. Enter a value only to replace it.' : 'No key is configured.'}</Text><Button label="Replace API key" variant="secondary" onPress={requestReplaceKey} loading={keySaving} style={{ marginTop: 8 }} /><Button label="Clear configured key" variant="danger" onPress={() => setConfirm('clear')} disabled={!configured || keySaving} style={{ marginTop: 12 }} />
    <Button label="Open practice to test" variant="secondary" onPress={handleTestConfig} style={{ marginTop: 12 }} />
  </ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.bg.primary }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, paddingHorizontal: layout.screenPaddingH, borderBottomWidth: 1, borderBottomColor: colors.primary[800] }, back: { ...text.labelMd, color: colors.primary[800], minWidth: 104 }, headerTitle: { ...text.labelMd, color: colors.primary[800] }, content: { padding: layout.screenPaddingH, paddingBottom: 48, gap: 10 }, title: { ...text.displayLg, color: colors.primary[800] }, sub: { ...text.bodyMd, color: colors.neutral[500], lineHeight: 22 }, label: { ...text.labelMd, color: colors.neutral[600], marginTop: 10 }, options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, option: { borderWidth: 1, borderColor: colors.primary[300], padding: 10 }, selected: { borderColor: colors.primary[800], backgroundColor: colors.teal[400] }, optionText: { ...text.bodySm, color: colors.primary[800], textTransform: 'capitalize' }, hint: { ...text.caption, color: colors.neutral[500], marginTop: -10 } });
