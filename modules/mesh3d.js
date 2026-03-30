// mesh3d.js — Three.js 3D mesh visualization
// The PANTHEON view: peers as glowing nodes, connections as beams,
// you in the center, the network orbiting around you.

let THREE, scene, camera, renderer, animId;
let nodes = new Map();   // peerId → { mesh, label, glow }
let edges = new Map();   // "a-b" → line
let selfNode = null;
let container = null;
let mouseX = 0, mouseY = 0;
let clock = null;

const COLORS = {
  self:   0x58a6ff,
  peer:   0x3fb950,
  edge:   0x30363d,
  bg:     0x0a0a0f,
  glow:   0x58a6ff,
  speak:  0xf0e68c,
  screen: 0xa371f7,
};

async function init(el) {
  container = el;
  THREE = await import('https://esm.run/three');
  clock = new THREE.Clock();

  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.bg);
  scene.fog = new THREE.FogExp2(COLORS.bg, 0.015);

  // Camera
  const w = container.clientWidth;
  const h = container.clientHeight;
  camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 500);
  camera.position.set(0, 8, 20);
  camera.lookAt(0, 0, 0);

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  // Lights
  const amb = new THREE.AmbientLight(0x404050, 0.6);
  scene.add(amb);
  const point = new THREE.PointLight(COLORS.glow, 1.5, 100);
  point.position.set(0, 15, 0);
  scene.add(point);

  // Grid floor
  const grid = new THREE.GridHelper(40, 40, 0x1a1a2e, 0x111122);
  grid.position.y = -2;
  scene.add(grid);

  // Particle field (stars)
  const starGeo = new THREE.BufferGeometry();
  const starVerts = [];
  for (let i = 0; i < 500; i++) {
    starVerts.push(
      (Math.random() - 0.5) * 200,
      (Math.random() - 0.5) * 200,
      (Math.random() - 0.5) * 200
    );
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starVerts, 3));
  const starMat = new THREE.PointsMaterial({ color: 0x334455, size: 0.3 });
  scene.add(new THREE.Points(starGeo, starMat));

  // Self node (center)
  selfNode = createNode(COLORS.self, 1.2, true);
  selfNode.position.set(0, 0, 0);
  scene.add(selfNode);

  // Mouse tracking for camera orbit
  container.addEventListener('mousemove', (e) => {
    mouseX = (e.clientX / w - 0.5) * 2;
    mouseY = (e.clientY / h - 0.5) * 2;
  });

  // Resize
  const ro = new ResizeObserver(() => resize());
  ro.observe(container);

  animate();
  console.log('[mesh3d] initialized');
}

function createNode(color, size = 0.8, isSelf = false) {
  const group = new THREE.Group();

  // Core sphere
  const geo = isSelf
    ? new THREE.IcosahedronGeometry(size, 2)
    : new THREE.OctahedronGeometry(size, 1);
  const mat = new THREE.MeshPhongMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.3,
    transparent: true,
    opacity: 0.85,
    shininess: 80,
  });
  const mesh = new THREE.Mesh(geo, mat);
  group.add(mesh);

  // Glow ring
  const ringGeo = new THREE.RingGeometry(size * 1.3, size * 1.6, 32);
  const ringMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.15,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  group.userData = { mesh, ring, mat, baseColor: color };
  return group;
}

function createEdge(from, to) {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const mat = new THREE.LineBasicMaterial({
    color: COLORS.edge,
    transparent: true,
    opacity: 0.4,
  });
  return new THREE.Line(geo, mat);
}

function addPeer(peerId, name) {
  if (nodes.has(peerId)) return;

  const count = nodes.size;
  const angle = (count / Math.max(nodes.size + 1, 1)) * Math.PI * 2;
  const radius = 6 + Math.random() * 4;
  const y = (Math.random() - 0.5) * 3;

  const node = createNode(COLORS.peer, 0.7);
  node.position.set(
    Math.cos(angle) * radius,
    y,
    Math.sin(angle) * radius
  );
  node.userData.name = name;
  node.userData.peerId = peerId;
  scene.add(node);
  nodes.set(peerId, node);

  // Edge from self to this peer
  const edge = createEdge(selfNode.position, node.position);
  scene.add(edge);
  edges.set(`self-${peerId}`, edge);

  // Edges to other peers (full mesh)
  nodes.forEach((otherNode, otherId) => {
    if (otherId === peerId) return;
    const key = [peerId, otherId].sort().join('-');
    if (!edges.has(key)) {
      const e = createEdge(node.position, otherNode.position);
      scene.add(e);
      edges.set(key, e);
    }
  });

  rebalance();
}

function removePeer(peerId) {
  const node = nodes.get(peerId);
  if (node) {
    scene.remove(node);
    nodes.delete(peerId);
  }

  // Remove edges involving this peer
  edges.forEach((line, key) => {
    if (key.includes(peerId)) {
      scene.remove(line);
      edges.delete(key);
    }
  });

  rebalance();
}

function setSpeaking(peerId, speaking) {
  const node = peerId === 'self' ? selfNode : nodes.get(peerId);
  if (!node) return;
  const { mat, baseColor } = node.userData;
  if (speaking) {
    mat.emissive.setHex(COLORS.speak);
    mat.emissiveIntensity = 0.8;
  } else {
    mat.emissive.setHex(baseColor);
    mat.emissiveIntensity = 0.3;
  }
}

function setSharing(peerId, sharing) {
  const node = peerId === 'self' ? selfNode : nodes.get(peerId);
  if (!node) return;
  const { mat, ring } = node.userData;
  if (sharing) {
    mat.color.setHex(COLORS.screen);
    mat.emissive.setHex(COLORS.screen);
    ring.material.color.setHex(COLORS.screen);
    ring.material.opacity = 0.4;
  } else {
    const base = node === selfNode ? COLORS.self : COLORS.peer;
    mat.color.setHex(base);
    mat.emissive.setHex(base);
    ring.material.color.setHex(base);
    ring.material.opacity = 0.15;
  }
}

// Rebalance peer positions evenly around center
function rebalance() {
  const count = nodes.size;
  let i = 0;
  nodes.forEach((node) => {
    const angle = (i / Math.max(count, 1)) * Math.PI * 2;
    const radius = 6 + (count > 6 ? 2 : 0);
    const targetX = Math.cos(angle) * radius;
    const targetZ = Math.sin(angle) * radius;
    node.userData.targetX = targetX;
    node.userData.targetZ = targetZ;
    i++;
  });
}

function updateEdges() {
  edges.forEach((line, key) => {
    const [a, b] = key.split('-');
    const nodeA = a === 'self' ? selfNode : nodes.get(a);
    const nodeB = b === 'self' ? selfNode : nodes.get(b);
    if (nodeA && nodeB) {
      const positions = line.geometry.attributes.position;
      positions.setXYZ(0, nodeA.position.x, nodeA.position.y, nodeA.position.z);
      positions.setXYZ(1, nodeB.position.x, nodeB.position.y, nodeB.position.z);
      positions.needsUpdate = true;
    }
  });
}

function animate() {
  animId = requestAnimationFrame(animate);
  const t = clock.getElapsedTime();

  // Self node gentle rotation + bob
  if (selfNode) {
    selfNode.rotation.y = t * 0.3;
    selfNode.position.y = Math.sin(t * 0.5) * 0.3;
  }

  // Peer nodes orbit + drift toward target positions
  nodes.forEach((node) => {
    node.rotation.y = t * 0.5;
    node.rotation.x = Math.sin(t * 0.3 + node.position.x) * 0.1;

    // Smooth drift to target
    if (node.userData.targetX !== undefined) {
      node.position.x += (node.userData.targetX - node.position.x) * 0.02;
      node.position.z += (node.userData.targetZ - node.position.z) * 0.02;
    }

    // Gentle float
    node.position.y += Math.sin(t + node.position.x) * 0.002;

    // Glow ring pulse
    const ring = node.userData.ring;
    if (ring) {
      ring.rotation.z = t * 0.2;
      ring.scale.setScalar(1 + Math.sin(t * 2 + node.position.z) * 0.1);
    }
  });

  // Update edge positions
  updateEdges();

  // Camera follows mouse subtly
  camera.position.x += (mouseX * 5 - camera.position.x) * 0.02;
  camera.position.y += (8 - mouseY * 3 - camera.position.y) * 0.02;
  camera.lookAt(0, 0, 0);

  renderer.render(scene, camera);
}

function resize() {
  if (!container || !camera || !renderer) return;
  const w = container.clientWidth;
  const h = container.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

function destroy() {
  if (animId) cancelAnimationFrame(animId);
  nodes.clear();
  edges.clear();
  selfNode = null;
  if (renderer) {
    renderer.dispose();
    renderer.domElement.remove();
  }
  scene = null;
  camera = null;
  renderer = null;
}

const Mesh3D = { init, addPeer, removePeer, setSpeaking, setSharing, destroy };
export default Mesh3D;
