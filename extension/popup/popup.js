// popup.js — full implementation in Task 4
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-options').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
});
