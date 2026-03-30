// bridge.js — GitHub Issue chat bridge + status beacon
// Polls a GitHub Issue for new comments and displays them in chat.
// Posts status beacon so external agents can query room state.

const Bridge = {
  active: false,
  issueUrl: null,
  owner: null,
  repo: null,
  issueNumber: null,
  token: null,
  lastSeen: null,
  pollInterval: null,
  beaconInterval: null,
  onMessage: null,
  seenIds: new Set(),
  getStatus: null,  // callback() → returns current room status object

  start(owner, repo, issueNumber, token) {
    this.owner = owner;
    this.repo = repo;
    this.issueNumber = issueNumber;
    this.token = token || null;
    this.issueUrl = `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`;
    this.active = true;
    this.seenIds.clear();
    this.lastSeen = new Date().toISOString();

    console.log(`[bridge] started polling ${owner}/${repo}#${issueNumber}`);
    this._poll(true);
    this.pollInterval = setInterval(() => this._poll(false), 5000);

    // Status beacon — post room state every 30s (only if token is available)
    if (this.token && this.getStatus) {
      this._postBeacon();
      this.beaconInterval = setInterval(() => this._postBeacon(), 30000);
    }
  },

  stop() {
    this.active = false;
    if (this.pollInterval) { clearInterval(this.pollInterval); this.pollInterval = null; }
    if (this.beaconInterval) { clearInterval(this.beaconInterval); this.beaconInterval = null; }
    console.log('[bridge] stopped');
  },

  async _poll(initial) {
    if (!this.active) return;
    try {
      const url = initial
        ? `${this.issueUrl}?per_page=20&sort=created&direction=desc`
        : `${this.issueUrl}?since=${this.lastSeen}&sort=created&direction=asc`;

      const headers = { 'Accept': 'application/vnd.github.v3+json' };
      if (this.token) headers['Authorization'] = `token ${this.token}`;

      const res = await fetch(url, { headers });
      if (!res.ok) return;

      const comments = await res.json();
      const toShow = initial ? comments.reverse().slice(-10) : comments;

      for (const c of toShow) {
        if (this.seenIds.has(c.id)) continue;
        this.seenIds.add(c.id);

        // Skip beacon posts
        if (c.body.startsWith('```json\n{"beacon"')) continue;

        const msg = {
          from: `gh:${c.user.login}`,
          name: c.user.login,
          text: c.body,
          timestamp: new Date(c.created_at).getTime(),
          bridge: true
        };

        if (this.onMessage) this.onMessage(msg);
        this.lastSeen = c.created_at;
      }
    } catch (e) {
      console.warn('[bridge] poll error:', e.message);
    }
  },

  async post(text, authorName) {
    if (!this.active || !this.token) return false;
    try {
      const body = `**${authorName}** (via GRIDLOCK):\n\n${text}`;
      const res = await fetch(this.issueUrl, {
        method: 'POST',
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'Authorization': `token ${this.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ body })
      });
      return res.ok;
    } catch (e) {
      return false;
    }
  },

  // Post room status as a JSON beacon comment
  async _postBeacon() {
    if (!this.active || !this.token || !this.getStatus) return;
    try {
      const status = this.getStatus();
      const body = '```json\n' + JSON.stringify(status, null, 2) + '\n```';
      await fetch(this.issueUrl, {
        method: 'POST',
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'Authorization': `token ${this.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ body })
      });
      console.log('[bridge] beacon posted');
    } catch (e) {
      console.warn('[bridge] beacon error:', e.message);
    }
  }
};

export default Bridge;
