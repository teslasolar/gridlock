// media.js — shared media grid
// Paste a URL → everyone sees it. YouTube, images, websites, anything.
// Synced via data channels. The grid IS the shared screen.

const Media = {
  items: [],       // { id, url, type, title, addedBy, timestamp }
  onUpdate: null,  // callback when grid changes

  // Detect what kind of URL this is
  detect(url) {
    try { new URL(url); } catch { return null; }

    // YouTube
    const ytMatch = url.match(
      /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
    );
    if (ytMatch) return { type: 'youtube', embedId: ytMatch[1] };

    // Image
    if (/\.(png|jpg|jpeg|gif|webp|svg|bmp|ico)(\?.*)?$/i.test(url)) return { type: 'image' };

    // Audio
    if (/\.(mp3|wav|ogg|flac|m4a)(\?.*)?$/i.test(url)) return { type: 'audio' };

    // Video (direct file)
    if (/\.(mp4|webm|mov|avi|mkv)(\?.*)?$/i.test(url)) return { type: 'video' };

    // Twitch
    const twitchMatch = url.match(/twitch\.tv\/(\w+)/);
    if (twitchMatch) return { type: 'twitch', channel: twitchMatch[1] };

    // Spotify embed
    if (url.includes('open.spotify.com')) {
      const spotifyUrl = url.replace('open.spotify.com/', 'open.spotify.com/embed/');
      return { type: 'spotify', embedUrl: spotifyUrl };
    }

    // SoundCloud
    if (url.includes('soundcloud.com')) return { type: 'soundcloud' };

    // Generic webpage — iframe it
    return { type: 'iframe' };
  },

  // Add a URL to the shared grid
  add(url, addedBy) {
    const info = this.detect(url);
    if (!info) return null;

    const item = {
      id: `media-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      url,
      ...info,
      addedBy,
      timestamp: Date.now()
    };

    this.items.push(item);
    if (this.onUpdate) this.onUpdate(this.items);
    return item;
  },

  // Remove from grid
  remove(id) {
    this.items = this.items.filter(i => i.id !== id);
    if (this.onUpdate) this.onUpdate(this.items);
  },

  // Remote peer shared media
  onRemoteAdd(item) {
    if (this.items.some(i => i.id === item.id)) return;
    this.items.push(item);
    if (this.onUpdate) this.onUpdate(this.items);
  },

  // Build embed HTML for an item
  render(item) {
    const container = document.createElement('div');
    container.className = 'media-cell';
    container.dataset.id = item.id;

    const header = document.createElement('div');
    header.className = 'media-cell-header';
    header.innerHTML = `<span class="media-who">${esc(item.addedBy)}</span><button class="media-close" data-id="${item.id}">&times;</button>`;
    container.appendChild(header);

    const body = document.createElement('div');
    body.className = 'media-cell-body';

    switch (item.type) {
      case 'youtube':
        body.innerHTML = `<iframe src="https://www.youtube.com/embed/${item.embedId}?autoplay=0" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
        break;

      case 'image':
        body.innerHTML = `<img src="${esc(item.url)}" alt="shared image" loading="lazy" />`;
        break;

      case 'video':
        body.innerHTML = `<video src="${esc(item.url)}" controls playsinline></video>`;
        break;

      case 'audio':
        body.innerHTML = `<audio src="${esc(item.url)}" controls></audio>`;
        break;

      case 'twitch':
        body.innerHTML = `<iframe src="https://player.twitch.tv/?channel=${item.channel}&parent=${location.hostname}" frameborder="0" allowfullscreen></iframe>`;
        break;

      case 'spotify':
        body.innerHTML = `<iframe src="${esc(item.embedUrl)}" frameborder="0" allow="encrypted-media"></iframe>`;
        break;

      case 'soundcloud':
        body.innerHTML = `<iframe scrolling="no" frameborder="no" src="https://w.soundcloud.com/player/?url=${encodeURIComponent(item.url)}&auto_play=false&show_artwork=true"></iframe>`;
        break;

      case 'iframe':
      default:
        body.innerHTML = `<iframe src="${esc(item.url)}" frameborder="0" sandbox="allow-scripts allow-same-origin allow-popups"></iframe>`;
        break;
    }

    container.appendChild(body);
    return container;
  },

  clear() {
    this.items = [];
    if (this.onUpdate) this.onUpdate(this.items);
  }
};

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

export default Media;
