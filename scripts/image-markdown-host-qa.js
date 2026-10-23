if (app.vault.adapter.basePath !== '/private/tmp/qiaomu-agent-pele-20261018/vault') throw Error('QA vault only');
const plugin = app.plugins.plugins['qiaomu-ai-rss'];
if (plugin.manifest.version !== '0.32.1') throw Error('Unexpected candidate');
for (const leaf of app.workspace.getLeavesOfType('qiaomu-ai-rss-reader')) leaf.detach();
await plugin.openReader();
const view = app.workspace.getLeavesOfType('qiaomu-ai-rss-reader')[0].view;
const id = '760dac152d4912508995aa1ea220f1e5';
const { bundle } = await plugin.api().article(id);
plugin.state.settings.remoteImages = true;
plugin.remember(bundle);
await view.openArticle(bundle.entry, 'rewrite');
const images = [...view.reader.querySelectorAll('.qrs-prose img')];
if (images.length !== 4) throw Error(`Expected 4 images, got ${images.length}`);
const results = [];
for (const img of images) {
  img.scrollIntoView({ block: 'center' });
  const deadline = Date.now() + 25000;
  while ((!img.complete || !img.naturalWidth) && !img.parentElement.classList.contains('is-error') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
  results.push({ loaded: img.complete && img.naturalWidth > 0, width: img.naturalWidth, height: img.naturalHeight, url: img.dataset.qrsImage });
}
images[2].scrollIntoView({ block: 'center' });
const result = { vault: app.vault.getName(), version: plugin.manifest.version, mode: view.mode, imageCount: images.length, images: results, literalBrokenImage: view.reader.querySelector('.qrs-prose').textContent.includes('![') };
if (results.some(item => !item.loaded) || result.literalBrokenImage) throw Error(JSON.stringify(result));
return result;
