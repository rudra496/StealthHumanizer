'use client';

import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { Sparkles, FileText, ArrowRight } from 'lucide-react';
import Navbar from '@/components/Navbar';
import Humanizer from '@/components/Humanizer';
import BatchHumanizer from '@/components/BatchHumanizer';
import Detector from '@/components/Detector';
import History from '@/components/History';
import Settings from '@/components/Settings';
import ObservabilityDashboard from '@/components/ObservabilityDashboard';
import Toast from '@/components/Toast';
import Footer from '@/components/Footer';
import { Toast as ToastType, Tab } from '@/lib/types';
import { getTheme, setTheme as saveTheme, hasVisited, markVisited } from '@/lib/storage';

function HeroSection() {
  const scrollToHumanizer = () => {
    document.getElementById('humanizer-section')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <section className="relative overflow-hidden py-16 md:py-24">
      {/* Background glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-accent-500/10 rounded-full blur-3xl" />
      </div>

      <div className="relative container mx-auto px-4 max-w-7xl text-center">
        <div className="animate-fade-in-up">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-accent-500/10 border border-accent-500/20 text-accent-400 text-sm mb-6">
            <Sparkles className="w-4 h-4" /> Free & Open Source — No Login Required
          </div>
          <h1 className="text-4xl md:text-6xl font-extrabold text-white mb-4 leading-tight">
            Transform <span className="hero-gradient">AI Text</span> Into<br />Natural Writing
          </h1>
          <p className="text-lg md:text-xl text-dark-300 max-w-2xl mx-auto mb-8">
            Free. No login. <strong className="text-dark-200">35 AI providers</strong>. Style-aware rewriting.
          </p>
        </div>

        {/* Feature highlights */}
        <div className="flex flex-wrap justify-center gap-4 md:gap-6 mb-10 animate-fade-in-up-delay">
          {[
            { icon: '⚡', label: 'Instant Humanization' },
            { icon: '🥷', label: 'Ninja Mode' },
            { icon: '📄', label: 'Upload PDF/DOCX' },
            { icon: '🔄', label: 'Multi-Pass' },
            { icon: '📝', label: 'Grammar Check' },
            { icon: '🌍', label: 'Multi-Language' },
          ].map(f => (
            <div key={f.label} className="glass-card rounded-xl px-4 py-3 flex items-center gap-2 text-sm text-dark-200 hover:border-accent-500/40 transition-colors">
              <span className="text-lg">{f.icon}</span> {f.label}
            </div>
          ))}
        </div>

        <button onClick={scrollToHumanizer}
          className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-gradient-to-r from-accent-500 to-accent-600 hover:from-accent-600 hover:to-accent-700 text-white font-semibold text-lg shadow-xl shadow-accent-500/25 hover:shadow-accent-500/40 transition-all duration-300 hover:scale-105 animate-fade-in-up-delay-2">
          Start Humanizing <ArrowRight className="w-5 h-5" />
        </button>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    { num: '1', icon: <FileText className="w-6 h-6" />, title: 'Paste or Upload', desc: 'Paste your AI-generated text or upload a PDF/DOCX file.' },
    { num: '2', icon: <Sparkles className="w-6 h-6" />, title: 'Choose Style', desc: 'Pick your preferred writing style, tone, and humanization level.' },
    { num: '3', icon: <ArrowRight className="w-6 h-6" />, title: 'Get Results', desc: 'Receive naturally humanized text in seconds.' },
  ];

  return (
    <section className="py-16">
      <div className="container mx-auto px-4 max-w-7xl">
        <h2 className="text-2xl md:text-3xl font-bold text-white text-center mb-3">How It Works</h2>
        <p className="text-dark-400 text-center mb-10">Three simple steps to natural writing</p>
        <div className="grid md:grid-cols-3 gap-6">
          {steps.map((s, i) => (
            <div key={i} className="glass-card rounded-2xl p-6 text-center hover:border-accent-500/30 transition-all duration-300 hover:-translate-y-1">
              <div className="w-12 h-12 rounded-full bg-accent-500/20 text-accent-400 flex items-center justify-center mx-auto mb-4">
                {s.icon}
              </div>
              <div className="text-xs text-accent-500 font-bold uppercase tracking-wider mb-2">Step {s.num}</div>
              <h3 className="text-lg font-semibold text-white mb-2">{s.title}</h3>
              <p className="text-dark-400 text-sm">{s.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function GroqFreeGuide() {
  const steps = [
    { num: '1', title: 'Open Settings and clear old keys', desc: 'Go to Settings → Danger Zone → Clear All API Keys (optional reset).', image: '/steps/1.jpg', width: 611, height: 1280 },
    { num: '2', title: 'Choose Groq (FREE)', desc: 'In Free Providers, select Groq (FREE).', image: '/steps/2.jpg', width: 608, height: 1280 },
    { num: '3', title: 'Click Get API Key', desc: 'Open Groq provider settings and click Get API Key.', image: '/steps/3.jpg', width: 653, height: 1280 },
    { num: '4', title: 'Create key in Groq Console', desc: 'Set a key name and expiration preference, then create key.', image: '/steps/4.jpg', width: 659, height: 1280 },
    { num: '5', title: 'Copy key', desc: 'Copy the generated Groq key immediately.', image: '/steps/5.jpg', width: 661, height: 1280 },
    { num: '6', title: 'Paste and save in app', desc: 'Paste key into the Groq API key field and press Save.', image: '/steps/6.jpg', width: 657, height: 1280 },
    { num: '7', title: 'Test key', desc: 'Click Test Key and confirm the key is valid.', image: '/steps/7.jpg', width: 655, height: 1280 },
    { num: '8', title: 'Keep Groq (FREE) active', desc: 'Return to provider selection and ensure Groq (FREE) is selected.', image: '/steps/8.jpg', width: 606, height: 1280 },
    { num: '9', title: 'Set humanizer preferences', desc: 'Configure rewrite level, style, tone, target score, and max words.', image: '/steps/9.jpg', width: 656, height: 1280 },
    { num: '10', title: 'Run the pipeline', desc: 'Paste/upload text and run rewrite → post-process → polish.', image: '/steps/10.jpg', width: 601, height: 1280 },
    { num: '11', title: 'Review and export', desc: 'Review output, re-humanize if needed, then export.', image: '/steps/11.jpg', width: 608, height: 1280 },
  ];

  return (
    <section className="py-16">
      <div className="container mx-auto px-4 max-w-7xl">
        <h2 className="text-2xl md:text-3xl font-bold text-white text-center mb-3">Groq (Free) Setup Walkthrough</h2>
        <p className="text-dark-400 text-center mb-10 max-w-3xl mx-auto">
          This guide is specifically for <strong className="text-dark-200">Groq (Free)</strong> setup and usage.
        </p>

        <div className="grid lg:grid-cols-2 gap-6">
          {steps.map((step) => (
            <article key={step.num} className="glass-card rounded-2xl p-5 border border-dark-700/40">
              <p className="text-xs text-accent-500 font-bold uppercase tracking-wider mb-2">Step {step.num}</p>
              <h3 className="text-lg font-semibold text-white mb-2">{step.title}</h3>
              <p className="text-dark-400 text-sm mb-4">{step.desc}</p>
              <Image src={step.image} alt={`Groq (Free) step ${step.num}: ${step.title}`} width={step.width} height={step.height} className="w-full h-auto rounded-xl border border-dark-700/40" />
            </article>
          ))}
        </div>

        <div className="glass-card rounded-2xl p-5 mt-8 border border-red-500/30">
          <p className="text-sm text-dark-200">
            <strong className="text-red-400">Safety:</strong> Never share API keys in public messages or screenshots. If you need to remove saved keys, use <strong>Settings → Danger Zone → Clear All API Keys</strong>.
          </p>
        </div>
      </div>
    </section>
  );
}

function TrustIndicators() {
  return (
    <section className="py-12">
      <div className="container mx-auto px-4 max-w-7xl text-center">
        <p className="text-dark-400 text-sm mb-4">Built for researchers & writers</p>
        <div className="flex flex-wrap justify-center gap-4 mb-6">
          {[
            { value: '35', label: 'AI Providers' },
            { value: '4', label: 'Rewrite Levels' },
            { value: '13', label: 'Tones' },
            { value: '16+', label: 'Languages' },
          ].map(s => (
            <div key={s.label} className="glass-card rounded-xl px-6 py-3 text-center min-w-[120px]">
              <p className="text-2xl font-bold hero-gradient">{s.value}</p>
              <p className="text-xs text-dark-400">{s.label}</p>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap justify-center gap-3 text-xs text-dark-500">
          <span className="px-3 py-1.5 rounded-full bg-dark-800/50 border border-dark-700/30">🔒 100% Private</span>
          <span className="px-3 py-1.5 rounded-full bg-dark-800/50 border border-dark-700/30">⚡ No Login Required</span>
          <span className="px-3 py-1.5 rounded-full bg-dark-800/50 border border-dark-700/30">🌐 Open Source</span>
          <span className="px-3 py-1.5 rounded-full bg-dark-800/50 border border-dark-700/30">🆓 Free & Open Source</span>
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>('humanizer');
  const [theme, setThemeState] = useState<'dark' | 'light'>('dark');
  const [toasts, setToasts] = useState<ToastType[]>([]);
  const [isReturningUser, setIsReturningUser] = useState(false);

  useEffect(() => {
    const saved = getTheme();
    setThemeState(saved);
    document.documentElement.classList.toggle('light', saved === 'light');
    document.documentElement.classList.toggle('dark', saved === 'dark');

    const visited = hasVisited();
    setIsReturningUser(visited);
    if (!visited) markVisited();
  }, []);

  const toggleTheme = () => {
    const t = theme === 'dark' ? 'light' : 'dark';
    setThemeState(t); saveTheme(t);
    document.documentElement.classList.toggle('light', t === 'light');
    document.documentElement.classList.toggle('dark', t === 'dark');
  };

  const showToast = useCallback((type: ToastType['type'], message: string) => {
    const id = crypto.randomUUID();
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  return (
    <div className={`min-h-screen ${theme} flex flex-col`}>
      <Navbar activeTab={activeTab} setActiveTab={setActiveTab} theme={theme} toggleTheme={toggleTheme} />

      {activeTab === 'humanizer' && (
        <>
          {!isReturningUser && <HeroSection />}
          {!isReturningUser && <HowItWorks />}
          {!isReturningUser && <GroqFreeGuide />}
          <main className={`container mx-auto px-4 py-6 max-w-7xl ${isReturningUser ? 'pt-24' : ''}`} id="humanizer-section">
            <Humanizer showToast={showToast} onGoToSettings={() => setActiveTab('settings')} isFirstVisit={!isReturningUser} />
          </main>
          {!isReturningUser && <TrustIndicators />}
        </>
      )}

      {activeTab === 'batch' && (
        <main className="container mx-auto px-4 py-6 max-w-7xl flex-1">
          <BatchHumanizer showToast={showToast} />
        </main>
      )}

      {activeTab !== 'humanizer' && activeTab !== 'batch' && (
        <main className="container mx-auto px-4 py-6 max-w-7xl flex-1">
          {activeTab === 'detector' && <Detector showToast={showToast} />}
          {activeTab === 'dashboard' && <ObservabilityDashboard showToast={showToast} />}
          {activeTab === 'history' && <History showToast={showToast} setActiveTab={setActiveTab} />}
          {activeTab === 'settings' && <Settings showToast={showToast} />}
        </main>
      )}

      <div className="fixed top-20 right-4 z-50 flex flex-col gap-2">
        {toasts.map(t => <Toast key={t.id} toast={t} onClose={() => setToasts(prev => prev.filter(x => x.id !== t.id))} />)}
      </div>
      <Footer />
    </div>
  );
}
