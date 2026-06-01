chrome.runtime.onMessage.addListener(message => {
  if (message.type !== 'STEALTHHUMANIZER_OPEN') return;
  const url = new URL(message.baseUrl || 'http://localhost:3000');
  url.searchParams.set('text', message.text || '');
  window.open(url.toString(), '_blank', 'noopener,noreferrer');
});
