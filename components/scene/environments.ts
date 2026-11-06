import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export type EnvMode = 'off' | 'studio' | 'sunset' | 'forest' | 'tavern' | 'dawn';

export interface EnvPresetSpec {
  label: string;
  dot: string;
  next: EnvMode;
  description: string;
  baseIntensity: number;
}

export const ENV_CONFIG: Record<EnvMode, EnvPresetSpec> = {
  off: {
    label: 'ENV: OFF',
    dot: 'bg-[#8c8477]/40 shadow-none',
    next: 'studio',
    description: 'Default baseline lighting (no environment effect)',
    baseIntensity: 0.3,
  },
  studio: {
    label: 'ENV: STUDIO',
    dot: 'bg-[#70c4ff] shadow-[0_0_6px_#70c4ff]',
    next: 'sunset',
    description: 'Clean portrait softbox lighting with crisp eye catchlights',
    baseIntensity: 1.15,
  },
  sunset: {
    label: 'ENV: SUNSET',
    dot: 'bg-[#ff9d42] shadow-[0_0_6px_#ff9d42]',
    next: 'forest',
    description: 'Warm golden hour sunlight with rich skin glow',
    baseIntensity: 1.3,
  },
  forest: {
    label: 'ENV: FOREST',
    dot: 'bg-[#62c974] shadow-[0_0_6px_#62c974]',
    next: 'tavern',
    description: 'Overcast Skyrim pine forest with cool skylight & mossy bounce',
    baseIntensity: 1.1,
  },
  tavern: {
    label: 'ENV: HEARTH',
    dot: 'bg-[#ff6f3c] shadow-[0_0_6px_#ff6f3c]',
    next: 'dawn',
    description: 'Cozy hearth & candlelight with moody warm highlights',
    baseIntensity: 1.4,
  },
  dawn: {
    label: 'ENV: DAWN',
    dot: 'bg-[#c59eff] shadow-[0_0_6px_#c59eff]',
    next: 'off',
    description: 'Cool ethereal morning mist with porcelain skin tones',
    baseIntensity: 1.1,
  },
};

/**
 * Procedurally authors a self-contained 3D environment scene for PMREMGenerator.
 *
 * Each preset is rendered once on the GPU directly into a pre-filtered
 * environment cubemap (IBL). This is 100% offline, zero network requests,
 * and produces genuine HDR reflections and skin diffuse irradiance.
 */
export function createEnvironmentScene(mode: EnvMode): THREE.Scene {
  if (mode === 'off') {
    return new RoomEnvironment();
  }

  const scene = new THREE.Scene();

  if (mode === 'studio') {
    scene.background = new THREE.Color('#0d0f12');

    // Key softbox (screen-right, warm white, large)
    const keyGeo = new THREE.PlaneGeometry(3.5, 4.5);
    const keyMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#fff7ee').multiplyScalar(10),
      side: THREE.DoubleSide,
    });
    const key = new THREE.Mesh(keyGeo, keyMat);
    key.position.set(2.8, 1.8, 3.2);
    key.lookAt(0, 0, 0);
    scene.add(key);

    // Fill softbox (screen-left, gentle cool daylight)
    const fillGeo = new THREE.PlaneGeometry(3.0, 4.0);
    const fillMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#dce7f5').multiplyScalar(3.5),
      side: THREE.DoubleSide,
    });
    const fill = new THREE.Mesh(fillGeo, fillMat);
    fill.position.set(-3.2, 0.9, 2.8);
    fill.lookAt(0, 0, 0);
    scene.add(fill);

    // Hair kicker / rim light (overhead rear)
    const rimGeo = new THREE.PlaneGeometry(4.0, 1.6);
    const rimMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ffffff').multiplyScalar(6),
      side: THREE.DoubleSide,
    });
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.position.set(0, 3.8, -2.8);
    rim.lookAt(0, 0, 0);
    scene.add(rim);

    // Floor reflector
    const floorGeo = new THREE.PlaneGeometry(8, 8);
    const floorMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#22252a'),
      side: THREE.DoubleSide,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -2.5;
    scene.add(floor);
  } else if (mode === 'sunset') {
    scene.background = new THREE.Color('#381b3e');

    // Low setting sun orb
    const sunGeo = new THREE.SphereGeometry(1.2, 16, 16);
    const sunMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ffa834').multiplyScalar(22),
    });
    const sun = new THREE.Mesh(sunGeo, sunMat);
    sun.position.set(5.5, 1.6, -1.8);
    scene.add(sun);

    // Golden sky horizon glow
    const horizGeo = new THREE.PlaneGeometry(16, 4);
    const horizMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ff7822').multiplyScalar(5),
      side: THREE.DoubleSide,
    });
    const horiz = new THREE.Mesh(horizGeo, horizMat);
    horiz.position.set(4, 1, -2);
    horiz.lookAt(0, 0, 0);
    scene.add(horiz);

    // Dusk upper sky dome panel
    const skyGeo = new THREE.PlaneGeometry(12, 6);
    const skyMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#4c285e').multiplyScalar(2),
      side: THREE.DoubleSide,
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.position.set(0, 5, 0);
    sky.rotation.x = Math.PI / 2;
    scene.add(sky);

    // Warm earth bounce
    const floorGeo = new THREE.PlaneGeometry(10, 10);
    const floorMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#582414').multiplyScalar(2),
      side: THREE.DoubleSide,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -2.5;
    scene.add(floor);
  } else if (mode === 'forest') {
    scene.background = new THREE.Color('#16221d');

    // Overcast Nordic sky ceiling
    const skyGeo = new THREE.PlaneGeometry(12, 12);
    const skyMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#94b5cd').multiplyScalar(4.5),
      side: THREE.DoubleSide,
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.position.set(0, 5, 0);
    sky.rotation.x = Math.PI / 2;
    scene.add(sky);

    // Canopy sunlight filter (pale gold sunbeam through branches)
    const beamGeo = new THREE.PlaneGeometry(3, 3);
    const beamMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#fff2cf').multiplyScalar(8),
      side: THREE.DoubleSide,
    });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.set(2.5, 4.2, 2.2);
    beam.lookAt(0, 0, 0);
    scene.add(beam);

    // Mossy ground and spruce pine surround
    const floorGeo = new THREE.PlaneGeometry(10, 10);
    const floorMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#1c2e1c').multiplyScalar(2.2),
      side: THREE.DoubleSide,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -2.5;
    scene.add(floor);

    // Surrounding pine bark panels
    const treeGeo = new THREE.BoxGeometry(1.5, 6, 1.5);
    const treeMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#1a1714'),
    });
    const t1 = new THREE.Mesh(treeGeo, treeMat);
    t1.position.set(-3.5, 1, -2);
    scene.add(t1);
  } else if (mode === 'tavern') {
    scene.background = new THREE.Color('#140d08');

    // Fireplace / Hearth glow
    const fireGeo = new THREE.PlaneGeometry(2.8, 2.2);
    const fireMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ff5511').multiplyScalar(16),
      side: THREE.DoubleSide,
    });
    const fire = new THREE.Mesh(fireGeo, fireMat);
    fire.position.set(-2.6, -0.4, 2.2);
    fire.lookAt(0, 0, 0);
    scene.add(fire);

    // Secondary embers / coals
    const emberGeo = new THREE.PlaneGeometry(2, 1);
    const emberMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ffaa22').multiplyScalar(10),
      side: THREE.DoubleSide,
    });
    const ember = new THREE.Mesh(emberGeo, emberMat);
    ember.position.set(-2.4, -0.9, 2.5);
    ember.lookAt(0, 0, 0);
    scene.add(ember);

    // Candle cluster on right
    const candleGeo = new THREE.SphereGeometry(0.3, 8, 8);
    const candleMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ffd580').multiplyScalar(12),
    });
    const candle = new THREE.Mesh(candleGeo, candleMat);
    candle.position.set(2.8, 0.4, 2.0);
    scene.add(candle);

    // Dark timber wood surround
    const woodGeo = new THREE.BoxGeometry(10, 8, 10);
    const woodMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#1e140d'),
      side: THREE.BackSide,
    });
    const wood = new THREE.Mesh(woodGeo, woodMat);
    wood.position.set(0, 1, 0);
    scene.add(wood);
  } else if (mode === 'dawn') {
    scene.background = new THREE.Color('#25283b');

    // Dawn upper sky (pale periwinkle/lavender)
    const skyGeo = new THREE.PlaneGeometry(12, 12);
    const skyMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#9bb4db').multiplyScalar(3.8),
      side: THREE.DoubleSide,
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.position.set(0, 5, 0);
    sky.rotation.x = Math.PI / 2;
    scene.add(sky);

    // Rose / peach horizon band
    const roseGeo = new THREE.PlaneGeometry(14, 3.5);
    const roseMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#f0b8be').multiplyScalar(4.5),
      side: THREE.DoubleSide,
    });
    const rose = new THREE.Mesh(roseGeo, roseMat);
    rose.position.set(3.5, 1.2, -2.5);
    rose.lookAt(0, 0, 0);
    scene.add(rose);

    // Morning sun orb
    const sunGeo = new THREE.SphereGeometry(0.9, 16, 16);
    const sunMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#fff2e0').multiplyScalar(14),
    });
    const sun = new THREE.Mesh(sunGeo, sunMat);
    sun.position.set(4.2, 0.9, 2.2);
    scene.add(sun);

    // Cool morning mist floor
    const floorGeo = new THREE.PlaneGeometry(10, 10);
    const floorMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#2d3648').multiplyScalar(1.5),
      side: THREE.DoubleSide,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -2.5;
    scene.add(floor);
  }

  return scene;
}
