'use client';

import { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Key, Eye, EyeOff, ExternalLink, Shield, Check, X, Zap, Star, RotateCcw } from 'lucide-react';
import { WEB_PROVIDERS as PROVIDERS, getProvider, testApiKey } from '@/lib/providers';
import { getApiKeys, setApiKeys, clearApiKeys } from '@/lib/storage';
import { ModelProvider } from '@/lib/types';

interface SettingsProps {
  showToast: (type: 'success' | 'error' | 'info' | 'warning', message: string) => void;
}

export default function Settings({ showToast }: SettingsProps) {
  const [keys, setKeys] = useState<Record<string, string | undefined>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [selectedProvider, setSelectedProvider] = useState<string>('gemini');
  const [testing, setTesting] = useState<string | null>(null);
  const [quickKey, setQuickKey] = useState('');
  const [quickTesting, setQuickTesting] = useState(false);
  const [quickStatus, setQuickStatus] = useState<'idle' | 'testing' | 'valid' | 'invalid'>('idle');
  const [testAllStatus, setTestAllStatus] = useState<Record<string, 'valid' | 'invalid' | 'testing'>>({});

  useEffect(() => { setKeys(getApiKeys()); }, []);

  const handleSave = (id: string, key: string) => {
    // Trim whitespace and validate the key is not empty
    const trimmedKey = key?.trim();
    if (!trimmedKey) {
      showToast('warning', 'API key cannot be empty');
      return;
    }
    
    const newKeys = { ...keys, [id]: trimmedKey };
    setKeys(newKeys);
    setApiKeys(newKeys);
    showToast('success', `${getProvider(id as any)?.name || id} API key saved!`);
  };

  const handleClearAll = () => { setKeys({}); clearApiKeys(); showToast('info', 'All API keys cleared'); };

  const handleTest = async (id: string) => {
    const key = keys[id];
    if (!key || !key.trim()) { 
      showToast('warning', 'No API key to test'); 
      return; 
    }
    setTesting(id);
    showToast('info', `Testing ${id}...`);
    try {
      const valid = await testApiKey(id as any, key.trim());
      setTesting(null);
      if (valid) {
        showToast('success', `${id} key is valid! ✅`);
      } else {
        showToast('error', `${id} key is invalid. Please check your API key and try again. ❌`);
      }
    } catch (err: any) {
      setTesting(null);
      showToast('error', `Error testing key: ${err.message || 'Unknown error'}`);
    }
  };

  const current = getProvider(selectedProvider as any);

  const handleQuickSetup = async () => {
    if (!quickKey.trim()) { showToast('warning', 'Please enter an API key'); return; }
    setQuickTesting(true);
    setQuickStatus('testing');
    try {
      const valid = await testApiKey('gemini' as ModelProvider, quickKey.trim());
      if (valid) {
        handleSave('gemini', quickKey.trim());
        setQuickStatus('valid');
        showToast('success', 'Gemini key saved and verified! You\'re ready to go.');
      } else {
        setQuickStatus('invalid');
        showToast('error', 'Invalid Gemini key. Check and try again.');
      }
    } catch (err: any) {
      setQuickStatus('invalid');
      showToast('error', `Error: ${err.message}`);
    } finally {
      setQuickTesting(false);
    }
  };

  const handleTestAll = async () => {
    const entries = Object.entries(keys).filter(([_, v]) => v && v.trim().length > 0);
    if (entries.length === 0) { showToast('warning', 'No keys to test'); return; }
    const status: Record<string, 'valid' | 'invalid' | 'testing'> = {};
    entries.forEach(([id]) => { status[id] = 'testing'; });
    setTestAllStatus(status);
    let validCount = 0;
    await Promise.all(entries.map(async ([id, key]) => {
      try {
        const ok = await testApiKey(id as ModelProvider, key!);
        setTestAllStatus(prev => ({ ...prev, [id]: ok ? 'valid' : 'invalid' }));
        if (ok) validCount++;
      } catch {
        setTestAllStatus(prev => ({ ...prev, [id]: 'invalid' }));
      }
    }));
    showToast('success', `${validCount}/${entries.length} key(s) valid`);
  };

  const freeProviders = PROVIDERS.filter(p => p.free);
  const paidProviders = PROVIDERS.filter(p => !p.free);

  return (
    <div className="space-y-6 animate-fade-in max-w-4xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <SettingsIcon className="w-6 h-6 text-accent-400" /> Settings
        </h2>
        <p className="text-dark-400 mt-1">Configure API keys — stored locally in your browser only</p>
      </div>

      <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-4 flex items-start gap-3">
        <Shield className="w-5 h-5 text-accent-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm text-dark-200">Your API keys are stored <strong>only in your browser&apos;s localStorage</strong>.</p>
          <p className="text-xs text-dark-400 mt-1">They never leave your device. Text goes directly to the AI provider you choose.</p>
        </div>
      </div>

      {/* Quick Setup */}
      <div className="bg-gradient-to-br from-accent-500/10 to-accent-600/5 border border-accent-500/30 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Zap className="w-5 h-5 text-accent-400" />
          <h3 className="text-lg font-medium text-white">Quick Setup</h3>
          <span className="px-2 py-0.5 rounded-full bg-accent-500/20 text-accent-400 text-xs font-medium">Fastest way to start</span>
        </div>
        <p className="text-sm text-dark-300 mb-3">Get started in 30 seconds with a free Gemini API key:</p>
        <div className="flex gap-2">
          <input type="password" value={quickKey} onChange={e => { setQuickKey(e.target.value); setQuickStatus('idle'); }}
            placeholder="Paste your Gemini API key here..."
            className="flex-1 px-4 py-2.5 bg-dark-900/50 border border-dark-700/50 rounded-lg text-white placeholder-dark-500 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500/50" />
          <button onClick={handleQuickSetup} disabled={quickTesting}
            className="px-5 py-2.5 rounded-lg bg-accent-500 text-white font-medium text-sm hover:bg-accent-600 transition-colors disabled:opacity-50">
            {quickTesting ? 'Verifying...' : 'Save & Verify'}
          </button>
        </div>
        {quickStatus === 'valid' && <p className="text-xs text-green-400 mt-2">Key verified and saved! You can start humanizing now.</p>}
        {quickStatus === 'invalid' && <p className="text-xs text-red-400 mt-2">Invalid key. <a href="https://aistudio.google.com/apikey" target="_blank" className="underline">Get one here</a>.</p>}
        <div className="flex items-center gap-3 mt-3">
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer"
            className="text-xs text-accent-400 hover:underline flex items-center gap-1">
            <ExternalLink className="w-3 h-3" /> Get free Gemini key
          </a>
          {Object.values(keys).some(v => v && v.trim().length > 0) && (
            <button onClick={handleTestAll} className="text-xs text-dark-400 hover:text-white flex items-center gap-1 transition-colors">
              <RotateCcw className="w-3 h-3" /> Test all saved keys
            </button>
          )}
        </div>
        {Object.keys(testAllStatus).length > 0 && (
          <div className="flex gap-2 flex-wrap mt-3">
            {Object.entries(testAllStatus).map(([id, status]) => (
              <span key={id} className={`px-2 py-1 rounded text-xs ${
                status === 'valid' ? 'bg-green-500/20 text-green-400' :
                status === 'invalid' ? 'bg-red-500/20 text-red-400' :
                'bg-dark-700/50 text-dark-400'
              }`}>
                {status === 'testing' ? 'Testing' : status === 'valid' ? 'Valid' : 'Invalid'}: {id}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Free Providers */}
      <div>
        <h3 className="text-lg font-medium text-white mb-3 flex items-center gap-2">
          <Zap className="w-5 h-5 text-green-400" /> Free Providers
          <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400">No cost</span>
        </h3>
        <div className="grid gap-3">
          {freeProviders.map(provider => (
            <div key={provider.id} onClick={() => setSelectedProvider(provider.id)}
              className={`bg-dark-800/50 border rounded-xl p-4 cursor-pointer transition-all ${
                selectedProvider === provider.id ? 'border-accent-500/50 bg-accent-500/5' : 'border-dark-700/50 hover:border-dark-600'
              }`}>
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h4 className="font-medium text-white">{provider.name}</h4>
                    {provider.id === 'gemini' && <Star className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400" />}
                    {keys[provider.id] && <Check className="w-4 h-4 text-green-400" />}
                    {testAllStatus[provider.id] === 'valid' && <span className="text-xs px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400">Valid</span>}
                    {testAllStatus[provider.id] === 'invalid' && <span className="text-xs px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-400">Invalid</span>}
                    <span className="text-xs px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400">FREE</span>
                  </div>
                  <p className="text-sm text-dark-400 mt-1">{provider.description}</p>
                </div>
                <Eye className="w-4 h-4 text-dark-500" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Paid Providers */}
      <div>
        <h3 className="text-lg font-medium text-white mb-3">Paid Providers</h3>
        <div className="grid gap-3">
          {paidProviders.map(provider => (
            <div key={provider.id} onClick={() => setSelectedProvider(provider.id)}
              className={`bg-dark-800/50 border rounded-xl p-4 cursor-pointer transition-all ${
                selectedProvider === provider.id ? 'border-accent-500/50 bg-accent-500/5' : 'border-dark-700/50 hover:border-dark-600'
              }`}>
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h4 className="font-medium text-white">{provider.name}</h4>
                    {keys[provider.id] && <Check className="w-4 h-4 text-green-400" />}
                  </div>
                  <p className="text-sm text-dark-400 mt-1">{provider.description}</p>
                </div>
                <Eye className="w-4 h-4 text-dark-500" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Selected Provider Config */}
      {current && (
        <div className="bg-dark-800/50 border border-accent-500/30 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium text-white">{current.name}</h3>
              <p className="text-sm text-dark-400">{current.description}</p>
            </div>
            {current.free && <span className="px-3 py-1 rounded-full bg-green-500/20 text-green-400 text-sm font-medium">Free</span>}
          </div>

          <div>
            <label className="block text-sm font-medium text-dark-300 mb-2">API Key</label>
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <input type={showKeys[current.id] ? 'text' : 'password'}
                  value={keys[current.id] || ''}
                  onChange={e => setKeys(prev => ({ ...prev, [current.id]: e.target.value }))}
                  placeholder={current.placeholder}
                  className="w-full px-4 py-3 bg-dark-900/50 border border-dark-700/50 rounded-lg text-white placeholder-dark-500 focus:outline-none focus:ring-2 focus:ring-accent-500/50 pr-10" />
                <button onClick={() => setShowKeys(prev => ({ ...prev, [current.id]: !prev[current.id] }))}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-dark-500 hover:text-dark-300">
                  {showKeys[current.id] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <button onClick={() => handleSave(current.id, keys[current.id] || '')}
                className="px-4 py-3 rounded-lg bg-accent-500 text-white font-medium hover:bg-accent-600 transition-colors">
                Save
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button onClick={() => handleTest(current.id)} disabled={testing === current.id}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-dark-700 hover:bg-dark-600 text-dark-200 text-sm disabled:opacity-50">
              {testing === current.id ? <div className="w-4 h-4 border-2 border-dark-400 border-t-white rounded-full animate-spin" /> : <Check className="w-4 h-4" />}
              {testing === current.id ? 'Testing...' : 'Test Key'}
            </button>
            <a href={current.getApiKeyUrl} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-dark-700 hover:bg-dark-600 text-dark-200 text-sm">
              <ExternalLink className="w-4 h-4" /> Get API Key
            </a>
            {current.docsUrl && (
              <a href={current.docsUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-dark-700 hover:bg-dark-600 text-dark-200 text-sm">
                <ExternalLink className="w-4 h-4" /> Docs
              </a>
            )}
          </div>

          {/* Model selector */}
          {current.models.length > 1 && (
            <div>
              <label className="block text-sm font-medium text-dark-300 mb-2">Model</label>
              <div className="flex flex-wrap gap-2">
                {current.models.map(m => (
                  <span key={m} className="px-3 py-1 rounded-lg bg-dark-700/50 text-dark-300 text-xs">{m}</span>
                ))}
              </div>
              <p className="text-xs text-dark-500 mt-1">Default: {current.defaultModel}</p>
            </div>
          )}

          {/* Gemini setup guide */}
          {current.id === 'gemini' && (
            <div className="bg-dark-900/50 rounded-lg p-4 text-sm space-y-1">
              <h4 className="font-medium text-dark-200">🆓 How to get a free Gemini API key:</h4>
              <ol className="text-dark-400 list-decimal list-inside space-y-0.5">
                <li>Go to <a href="https://aistudio.google.com/apikey" target="_blank" className="text-accent-400 hover:underline">Google AI Studio</a></li>
                <li>Sign in with Google</li>
                <li>Click &quot;Create API Key&quot;</li>
                <li>Copy & paste above — done! (15 req/min free)</li>
              </ol>
            </div>
          )}

          {/* Groq setup */}
          {current.id === 'groq' && (
            <div className="bg-dark-900/50 rounded-lg p-4 text-sm space-y-1">
              <h4 className="font-medium text-dark-200">🆓 Groq — Ultra-fast free inference:</h4>
              <ol className="text-dark-400 list-decimal list-inside space-y-0.5">
                <li>Go to <a href="https://console.groq.com/keys" target="_blank" className="text-accent-400 hover:underline">Groq Console</a></li>
                <li>Sign up (free)</li>
                <li>Create API key</li>
                <li>Paste above — uses Llama 3.3 70B for free!</li>
              </ol>
            </div>
          )}

          {/* OpenRouter setup */}
          {current.id === 'openrouter' && (
            <div className="bg-dark-900/50 rounded-lg p-4 text-sm space-y-1">
              <h4 className="font-medium text-dark-200">🆓 OpenRouter — Access to many free models:</h4>
              <ol className="text-dark-400 list-decimal list-inside space-y-0.5">
                <li>Go to <a href="https://openrouter.ai/keys" target="_blank" className="text-accent-400 hover:underline">OpenRouter Keys</a></li>
                <li>Sign up and create key</li>
                <li>Some models are free, others cost credits</li>
              </ol>
            </div>
          )}
        </div>
      )}

      {/* Provider Priority */}
      <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-6">
        <h3 className="text-lg font-medium text-white mb-3">Priority Order</h3>
        <p className="text-sm text-dark-400 mb-4">When multiple keys are set, first available is used:</p>
        <div className="space-y-2">
          {PROVIDERS.map((p, i) => (
            <div key={p.id} className="flex items-center gap-3 p-2 rounded-lg bg-dark-700/30 text-sm">
              <span className="w-6 h-6 rounded-full bg-dark-700 text-dark-300 flex items-center justify-center text-xs font-bold">{i + 1}</span>
              <span className="text-dark-200 flex-1">{p.name}</span>
              {keys[p.id] ? <Check className="w-4 h-4 text-green-400" /> : <X className="w-4 h-4 text-dark-600" />}
            </div>
          ))}
        </div>
      </div>

      {/* Danger Zone */}
      <div className="border border-red-500/30 rounded-xl p-6">
        <h3 className="text-lg font-medium text-red-400 mb-2">Danger Zone</h3>
        <p className="text-sm text-dark-400 mb-3">Remove all API keys from this browser.</p>
        <button onClick={handleClearAll} className="px-4 py-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 text-sm font-medium">Clear All API Keys</button>
      </div>
    </div>
  );
}
