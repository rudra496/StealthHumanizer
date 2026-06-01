chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'humanize-selection', title: 'Humanize with StealthHumanizer', contexts: ['selection'] });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'humanize-selection' || !tab?.id || !info.selectionText) return;
  const { baseUrl = 'http://localhost:3000' } = await chrome.storage.sync.get('baseUrl');
  chrome.tabs.sendMessage(tab.id, { type: 'STEALTHHUMANIZER_OPEN', text: info.selectionText, baseUrl });
});
