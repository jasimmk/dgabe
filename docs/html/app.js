const viewer = document.querySelector('#image-viewer');
const picture = document.querySelector('#viewer-image');
const caption = document.querySelector('#viewer-caption');
document.querySelectorAll('a[href="#build-notes"]').forEach(link => {
  link.addEventListener('click', () => { document.querySelector('#build-notes').open = true; });
});
if (viewer && typeof viewer.showModal === 'function') {
  document.querySelectorAll('[data-gallery]').forEach(link => {
    link.addEventListener('click', event => {
      event.preventDefault();
      picture.src = link.href;
      picture.alt = link.querySelector('img').alt;
      caption.textContent = link.dataset.caption;
      viewer.showModal();
    });
  });
  document.querySelector('#close-viewer').addEventListener('click', () => viewer.close());
  viewer.addEventListener('click', event => { if (event.target === viewer) viewer.close(); });
}
