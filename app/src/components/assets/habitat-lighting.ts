import * as THREE from "three";

// A single cached shadow map for static scenery. The companion keeps its contact
// shadow; animation and wind never force a second scene render on every frame.
export function configureHabitatRenderer(renderer: THREE.WebGLRenderer) {
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
}

export function configureHabitatShadow(light: THREE.DirectionalLight, mobile: boolean) {
  light.castShadow = true;
  light.shadow.mapSize.setScalar(mobile ? 512 : 1024);
  light.shadow.camera.left = light.shadow.camera.bottom = -13;
  light.shadow.camera.right = light.shadow.camera.top = 13;
  light.shadow.camera.near = 0.5;
  light.shadow.camera.far = 45;
  light.shadow.camera.updateProjectionMatrix();
  light.shadow.bias = -0.0003;
  light.shadow.normalBias = 0.04;
}
