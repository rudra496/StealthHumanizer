'use client';

import { Terminal, Users, AtSign, Video, Mail } from 'lucide-react';

const socials = [
  { name: 'GitHub', href: 'https://github.com/rudra496/StealthHumanizer', icon: Terminal },
  { name: 'LinkedIn', href: 'https://www.linkedin.com/in/rudrasarker', icon: Users },
  { name: 'X', href: 'https://x.com/Rudra496', icon: AtSign },
  { name: 'YouTube', href: 'https://youtube.com/@rudrasarker9732', icon: Video },
];

export default function Footer() {
  return (
    <footer className="border-t border-dark-700/50 bg-dark-950/80 backdrop-blur-sm mt-16">
      <div className="container mx-auto px-4 max-w-7xl py-12">
        <div className="grid md:grid-cols-3 gap-10">
          {/* Brand */}
          <div>
            <h3 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
              &#x1f977; StealthHumanizer
            </h3>
            <p className="text-dark-400 text-sm leading-relaxed">
              Free, open-source AI text humanizer. Transform AI-generated content into natural, human-like writing with 35 providers.
            </p>
          </div>

          {/* Quick Links */}
          <div>
            <h4 className="text-sm font-semibold text-dark-300 uppercase tracking-wider mb-4">Links</h4>
            <ul className="space-y-2.5 text-sm">
              <li><a href="https://github.com/rudra496/StealthHumanizer" target="_blank" rel="noopener noreferrer" className="text-dark-400 hover:text-accent-400 transition-colors">&#x2b50; Star on GitHub</a></li>
              <li><a href="https://github.com/rudra496/StealthHumanizer/issues" target="_blank" rel="noopener noreferrer" className="text-dark-400 hover:text-accent-400 transition-colors">Report an Issue</a></li>
              <li><a href="https://github.com/rudra496/StealthHumanizer/blob/master/extension/README.md" target="_blank" rel="noopener noreferrer" className="text-dark-400 hover:text-accent-400 transition-colors">Chrome Extension</a></li>
              <li><a href="mailto:rudrasarker130@gmail.com" className="text-dark-400 hover:text-accent-400 transition-colors">Contact</a></li>
            </ul>
          </div>

          {/* Social */}
          <div>
            <h4 className="text-sm font-semibold text-dark-300 uppercase tracking-wider mb-4">Connect</h4>
            <div className="flex gap-2.5">
              {socials.map(s => {
                const Icon = s.icon;
                return (
                  <a key={s.name} href={s.href} target="_blank" rel="noopener noreferrer"
                    className="p-2.5 rounded-xl bg-dark-800/50 hover:bg-accent-500/20 text-dark-400 hover:text-accent-400 transition-all duration-200 hover:scale-110"
                    title={s.name}>
                    <Icon className="w-4 h-4" />
                  </a>
                );
              })}
              <a href="mailto:rudrasarker130@gmail.com"
                className="p-2.5 rounded-xl bg-dark-800/50 hover:bg-accent-500/20 text-dark-400 hover:text-accent-400 transition-all duration-200 hover:scale-110"
                title="Email">
                <Mail className="w-4 h-4" />
              </a>
            </div>
            <p className="text-dark-500 text-xs mt-5">Made with &#x2764;&#xfe0f; by Rudra Sarker</p>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-dark-800/50 flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-dark-500">
          <p>&copy; {new Date().getFullYear()} StealthHumanizer. Open source under MIT License.</p>
          <div className="flex gap-4">
            <span className="flex items-center gap-1">&#x1f512; No data stored</span>
            <span className="flex items-center gap-1">&#x1f310; Privacy first</span>
            <span className="flex items-center gap-1">&#x26a1; Free forever</span>
          </div>
          <a
            href="https://websitelaunches.com/site/devhumanizer.tech"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block shrink-0 opacity-90 hover:opacity-100 transition-opacity"
            title="Verified public launch record on Website Launches"
          >
            <img
              src="https://websitelaunches.com/badge/devhumanizer.tech.svg"
              alt="Established online - Public launch record"
              width={255}
              height={55}
              loading="lazy"
            />
          </a>
        </div>
      </div>
    </footer>
  );
}
