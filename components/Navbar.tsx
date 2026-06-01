'use client';

import { PenTool, Search, History, Settings, Sun, Moon, Layers, Sparkles, Activity } from 'lucide-react';
import type { Tab } from '@/lib/types';

interface NavbarProps {
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
  theme: 'dark' | 'light';
  toggleTheme: () => void;
}

const tabs: { id: Tab; label: string; icon: typeof PenTool }[] = [
  { id: 'humanizer', label: 'Humanizer', icon: Sparkles },
  { id: 'batch', label: 'Batch', icon: Layers },
  { id: 'detector', label: 'Detector', icon: Search },
  { id: 'dashboard', label: 'Dashboard', icon: Activity },
  { id: 'history', label: 'History', icon: History },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export default function Navbar({ activeTab, setActiveTab, theme, toggleTheme }: NavbarProps) {
  return (
    <nav className="sticky top-0 z-40 border-b border-dark-700/50 bg-gradient-to-r from-dark-950 via-dark-900 to-dark-950/80 backdrop-blur-xl shadow-lg shadow-black/10">
      <div className="container mx-auto px-4 max-w-7xl">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent-500 to-accent-700 flex items-center justify-center shadow-lg shadow-accent-500/20 text-lg">
              🥷
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">
                <span className="hero-gradient">Stealth</span><span className="text-white">Humanizer</span>
                <span className="text-xs ml-1.5 px-1.5 py-0.5 rounded-full bg-accent-500/20 text-accent-400 align-middle">v2.1</span>
              </h1>
              <p className="text-xs text-dark-400">AI text humanizer • Free & Open Source</p>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-1 bg-dark-800/50 rounded-xl p-1">
            {tabs.map(tab => {
              const Icon = tab.icon;
              return (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                    activeTab === tab.id ? 'bg-accent-500 text-white shadow-lg shadow-accent-500/25' : 'text-dark-300 hover:text-white hover:bg-dark-700/50'
                  }`}>
                  <Icon className="w-4 h-4" />{tab.label}
                </button>
              );
            })}
          </div>
          <button onClick={toggleTheme} className="p-2 rounded-lg bg-dark-800/50 hover:bg-dark-700/50 transition-colors" aria-label="Toggle theme">
            {theme === 'dark' ? <Sun className="w-5 h-5 text-yellow-400" /> : <Moon className="w-5 h-5 text-dark-600" />}
          </button>
        </div>
        <div className="md:hidden flex items-center gap-1 pb-3 overflow-x-auto">
          {tabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
                  activeTab === tab.id ? 'bg-accent-500 text-white' : 'text-dark-300 bg-dark-800/50'
                }`}>
                <Icon className="w-4 h-4" />{tab.label}
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
