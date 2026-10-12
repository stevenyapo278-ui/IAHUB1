import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import * as THREE from 'three/webgpu';
import {
  atan,
  color,
  cos,
  deltaTime,
  float,
  Fn,
  hash,
  hue,
  If,
  instanceIndex,
  Loop,
  max,
  min,
  mix,
  mx_fractal_noise_float,
  mx_fractal_noise_vec3,
  pass,
  PI,
  pcurve,
  sin,
  storage,
  step,
  time,
  TWO_PI,
  uniform,
  uv,
  vec2,
  vec3,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

/* ── Fond animé « particules liées » (WebGPU) ─────────────────────────────────
   Port du demo three.js `webgpu_tsl_vfx_linkedparticles` (d'après l'expérience
   de Christophe Choffel) adapté en fond de page de connexion :
   - 4096 particules (contre 8192 dans le demo) — suffisant visuellement, 4× moins
     coûteux car la boucle de liens est O(n²)
   - la graine suit le curseur, et dérive sur une courbe de Lissajous dès que le
     pointeur est inactif : la scène vit toute seule au chargement
   - pas d'OrbitControls (le drag sur une page de connexion ne doit rien faire
     tourner) → dérive lente de la caméra + halo lumineux orbite
   - repli CSS animé sans WebGPU / en mouvement réduit                                   */

const NB_PARTICLES = 4096;

function FallbackBackdrop({ animated }) {
  const orbs = [
    { className: 'left-[12%] top-[18%] h-72 w-72 bg-blue-600/25', delay: 0 },
    { className: 'right-[14%] top-[32%] h-80 w-80 bg-indigo-500/20', delay: 1.2 },
    { className: 'left-[38%] bottom-[12%] h-64 w-64 bg-cyan-500/15', delay: 2.4 },
  ];
  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden bg-[#07090d]">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_35%,rgba(37,99,235,0.16),transparent_60%)]" />
      {orbs.map((orb) => (
        <motion.div
          key={orb.className}
          className={`absolute rounded-full blur-3xl ${orb.className}`}
          animate={animated ? { y: [0, -26, 0], x: [0, 14, 0], opacity: [0.7, 1, 0.7] } : undefined}
          transition={{ duration: 11, repeat: Infinity, ease: 'easeInOut', delay: orb.delay }}
        />
      ))}
    </div>
  );
}

export default function LinkedParticlesBackground() {
  const hostRef = useRef(null);
  // État initial : pas de WebGPU (Firefox sans flag, Safari ancien…) ou mouvement réduit
  // → jamais de canvas, juste le fond CSS animé. Calculé au montage pour éviter un setState dans l'effet.
  const [unsupported, setUnsupported] = useState(
    () => !navigator.gpu || window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host || unsupported) return undefined;

    let disposed = false;
    let teardown = null;
    const screenPointer = new THREE.Vector2(0, 0);
    const scenePointer = new THREE.Vector3();
    const spawnTarget = new THREE.Vector3();
    const raycastPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const raycaster = new THREE.Raycaster();
    let lastPointerAt = -10;

    (async () => {
      let renderer = null;
      let timer = null;
      try {
        const camera = new THREE.PerspectiveCamera(60, host.clientWidth / host.clientHeight, 0.1, 200);
        camera.position.set(0, 0, 10);

        const scene = new THREE.Scene();

        timer = new THREE.Timer();
        timer.connect(document);

        renderer = new THREE.WebGPURenderer({ antialias: true });
        renderer.setClearColor(0x07090d, 1);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
        renderer.setSize(host.clientWidth, host.clientHeight);
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.domElement.style.cssText = 'position:absolute;inset:0;display:block;';
        host.appendChild(renderer.domElement);
        await renderer.init();
        if (disposed) {
          renderer.dispose();
          return;
        }

        // ── Paramètres (valeurs de la démo three.js, sauf 4096 particules) ──
        const timeScale = uniform(1.0);
        const particleLifetime = uniform(0.5);
        const particleSize = uniform(1.0);
        const linksWidth = uniform(0.005);
        const colorOffset = uniform(0.0);
        const colorVariance = uniform(2.0);
        const colorRotationSpeed = uniform(0.7);
        const spawnIndex = uniform(0);
        const nbToSpawn = uniform(5);
        const spawnPosition = uniform(new THREE.Vector3(0, 0, 0));
        const previousSpawnPosition = uniform(new THREE.Vector3(0, 0, 0));
        const turbFrequency = uniform(0.5);
        const turbAmplitude = uniform(0.5);
        const turbOctaves = uniform(2);
        const turbLacunarity = uniform(2.0);
        const turbGain = uniform(0.5);
        const turbFriction = uniform(0.01);

        // Couleur d'une particule selon son index (bruit fractal sur la teinte)
        const getInstanceColor = Fn(([i]) =>
          hue(color(0x2f6bff), colorOffset.add(mx_fractal_noise_float(i.toFloat().mul(0.1), 2, 2.0, 0.5, colorVariance)))
        );

        // ── Buffers de particules (position xyz + durée de vie w) ──────────
        const particlePositions = storage(
          new THREE.StorageInstancedBufferAttribute(NB_PARTICLES, 4),
          'vec4',
          NB_PARTICLES
        );
        const particleVelocities = storage(
          new THREE.StorageInstancedBufferAttribute(NB_PARTICLES, 4),
          'vec4',
          NB_PARTICLES
        );

        renderer.compute(
          Fn(() => {
            particlePositions.element(instanceIndex).xyz.assign(vec3(10000.0));
            particlePositions.element(instanceIndex).w.assign(-1.0); // w<0 → particule morte
          })().compute(NB_PARTICLES)
        );

        // ── Rendu des particules (quads additives) ──────────────────────────
        const particleGeom = new THREE.PlaneGeometry(0.05, 0.05);
        const particleMaterial = new THREE.SpriteNodeMaterial();
        particleMaterial.blending = THREE.AdditiveBlending;
        particleMaterial.depthWrite = false;
        particleMaterial.positionNode = particlePositions.toAttribute();
        particleMaterial.scaleNode = vec2(particleSize);
        particleMaterial.rotationNode = atan(particleVelocities.toAttribute().y, particleVelocities.toAttribute().x);
        particleMaterial.colorNode = Fn(() => {
          const life = particlePositions.toAttribute().w;
          const modLife = pcurve(life.oneMinus(), 8.0, 1.0);
          const pulse = pcurve(
            sin(hash(instanceIndex).mul(TWO_PI).add(time.mul(0.5).mul(TWO_PI))).mul(0.5).add(0.5),
            0.25,
            0.25
          ).mul(10.0).add(1.0);
          return getInstanceColor(instanceIndex).mul(pulse.mul(modLife));
        })();
        particleMaterial.opacityNode = Fn(() => {
          const circle = step(uv().xy.sub(0.5).length(), 0.5);
          const life = particlePositions.toAttribute().w;
          return circle.mul(life);
        })();

        const particleMesh = new THREE.InstancedMesh(particleGeom, particleMaterial, NB_PARTICLES);
        particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        particleMesh.frustumCulled = false;
        scene.add(particleMesh);

        // ── Liens entre les 2 plus proches voisins de chaque particule ─────
        const linksIndices = [];
        for (let i = 0; i < NB_PARTICLES; i++) {
          const baseIndex = i * 8;
          for (let j = 0; j < 2; j++) {
            const offset = baseIndex + j * 4;
            linksIndices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
          }
        }

        const linksVerticesSBA = new THREE.StorageBufferAttribute(NB_PARTICLES * 8, 4);
        const linksColorsSBA = new THREE.StorageBufferAttribute(NB_PARTICLES * 8, 4);

        const linksGeom = new THREE.BufferGeometry();
        linksGeom.setAttribute('position', linksVerticesSBA);
        linksGeom.setAttribute('color', linksColorsSBA);
        linksGeom.setIndex(linksIndices);

        const linksMaterial = new THREE.MeshBasicNodeMaterial();
        linksMaterial.vertexColors = true;
        linksMaterial.side = THREE.DoubleSide;
        linksMaterial.transparent = true;
        linksMaterial.depthWrite = false;
        linksMaterial.depthTest = false;
        linksMaterial.blending = THREE.AdditiveBlending;
        linksMaterial.opacityNode = storage(linksColorsSBA, 'vec4', linksColorsSBA.count).toAttribute().w;

        const linksMesh = new THREE.Mesh(linksGeom, linksMaterial);
        linksMesh.frustumCulled = false;
        scene.add(linksMesh);

        // ── Mise à jour des particules + génération des liens ───────────────
        const updateParticles = Fn(() => {
          const position = particlePositions.element(instanceIndex).xyz;
          const life = particlePositions.element(instanceIndex).w;
          const velocity = particleVelocities.element(instanceIndex).xyz;
          const dt = deltaTime.mul(0.1).mul(timeScale);

          If(life.greaterThan(0.0), () => {
            const localVel = mx_fractal_noise_vec3(
              position.mul(turbFrequency),
              turbOctaves,
              turbLacunarity,
              turbGain,
              turbAmplitude
            ).mul(life.add(0.01));
            velocity.addAssign(localVel);
            velocity.mulAssign(turbFriction.oneMinus());
            position.addAssign(velocity.mul(dt));
            life.subAssign(dt.mul(particleLifetime.reciprocal()));

            const closestDist1 = float(10000.0).toVar();
            const closestPos1 = vec3(0.0).toVar();
            const closestLife1 = float(0.0).toVar();
            const closestDist2 = float(10000.0).toVar();
            const closestPos2 = vec3(0.0).toVar();
            const closestLife2 = float(0.0).toVar();

            Loop(NB_PARTICLES, ({ i }) => {
              const otherPart = particlePositions.element(i);
              If(i.notEqual(instanceIndex).and(otherPart.w.greaterThan(0.0)), () => {
                const otherPosition = otherPart.xyz;
                const dist = position.sub(otherPosition).lengthSq();
                const moreThanZero = dist.greaterThan(0.0);
                If(dist.lessThan(closestDist1).and(moreThanZero), () => {
                  closestDist1.assign(dist);
                  closestPos1.assign(otherPosition.xyz);
                  closestLife1.assign(otherPart.w);
                }).ElseIf(dist.lessThan(closestDist2).and(moreThanZero), () => {
                  closestDist2.assign(dist);
                  closestPos2.assign(otherPosition.xyz);
                  closestLife2.assign(otherPart.w);
                });
              });
            });

            const linksPositions = storage(linksVerticesSBA, 'vec4', linksVerticesSBA.count);
            const linksColors = storage(linksColorsSBA, 'vec4', linksColorsSBA.count);
            const firstLinkIndex = instanceIndex.mul(8);
            const secondLinkIndex = firstLinkIndex.add(4);

            linksPositions.element(firstLinkIndex).xyz.assign(position);
            linksPositions.element(firstLinkIndex).y.addAssign(linksWidth);
            linksPositions.element(firstLinkIndex.add(1)).xyz.assign(position);
            linksPositions.element(firstLinkIndex.add(1)).y.addAssign(linksWidth.negate());
            linksPositions.element(firstLinkIndex.add(2)).xyz.assign(closestPos1);
            linksPositions.element(firstLinkIndex.add(2)).y.addAssign(linksWidth.negate());
            linksPositions.element(firstLinkIndex.add(3)).xyz.assign(closestPos1);
            linksPositions.element(firstLinkIndex.add(3)).y.addAssign(linksWidth);

            linksPositions.element(secondLinkIndex).xyz.assign(position);
            linksPositions.element(secondLinkIndex).y.addAssign(linksWidth);
            linksPositions.element(secondLinkIndex.add(1)).xyz.assign(position);
            linksPositions.element(secondLinkIndex.add(1)).y.addAssign(linksWidth.negate());
            linksPositions.element(secondLinkIndex.add(2)).xyz.assign(closestPos2);
            linksPositions.element(secondLinkIndex.add(2)).y.addAssign(linksWidth.negate());
            linksPositions.element(secondLinkIndex.add(3)).xyz.assign(closestPos2);
            linksPositions.element(secondLinkIndex.add(3)).y.addAssign(linksWidth);

            const linkColor = getInstanceColor(instanceIndex);
            const l1 = max(0.0, min(closestLife1, life)).pow(0.8);
            const l2 = max(0.0, min(closestLife2, life)).pow(0.8);

            Loop(4, ({ i: k }) => {
              linksColors.element(firstLinkIndex.add(k)).xyz.assign(linkColor);
              linksColors.element(firstLinkIndex.add(k)).w.assign(l1);
              linksColors.element(secondLinkIndex.add(k)).xyz.assign(linkColor);
              linksColors.element(secondLinkIndex.add(k)).w.assign(l2);
            });
          });
        })()
          .compute(NB_PARTICLES)
          .setName('Update Particles');

        // ── Apparition des particules le long du trajet de la graine ────────
        const spawnParticles = Fn(() => {
          const particleIndex = spawnIndex.add(instanceIndex).mod(NB_PARTICLES).toInt();
          const position = particlePositions.element(particleIndex).xyz;
          const life = particlePositions.element(particleIndex).w;
          const velocity = particleVelocities.element(particleIndex).xyz;

          life.assign(1.0);

          const rTheta = hash(particleIndex).mul(TWO_PI);
          const rPhi = hash(particleIndex.add(1)).mul(PI);
          const rDir = vec3(
            sin(rTheta).mul(cos(rPhi)),
            sin(rTheta).mul(sin(rPhi)),
            cos(rTheta)
          );

          const pos = mix(
            previousSpawnPosition,
            spawnPosition,
            instanceIndex.toFloat().div(nbToSpawn.sub(1).toFloat()).clamp()
          );
          position.assign(pos.add(rDir.mul(0.01)));
          velocity.assign(rDir.mul(5.0));
        })()
          .compute(nbToSpawn.value)
          .setName('Spawn Particles');

        // ── Dôme facetté sombre + lumière orbite (profondeur du fond) ───────
        const backgroundGeom = new THREE.IcosahedronGeometry(80, 3).applyMatrix4(
          new THREE.Matrix4().makeScale(-1, 1, 1)
        );
        const backgroundMaterial = new THREE.MeshStandardNodeMaterial();
        backgroundMaterial.roughness = 0.45;
        backgroundMaterial.metalness = 0.9;
        backgroundMaterial.flatShading = true;
        backgroundMaterial.colorNode = color(0x04060a);
        const backgroundMesh = new THREE.Mesh(backgroundGeom, backgroundMaterial);
        scene.add(backgroundMesh);

        const light = new THREE.PointLight(0xffffff, 2600);
        scene.add(light);

        // ── Post-traitement (bloom) ─────────────────────────────────────────
        const scenePass = pass(scene, camera);
        const scenePassColor = scenePass.getTextureNode('output');
        const bloomPass = bloom(scenePassColor, 0.75, 0.1, 0.5);
        const renderPipeline = new THREE.RenderPipeline(renderer, scenePassColor.add(bloomPass));

        // ── Boucle d'animation ──────────────────────────────────────────────
        const onPointerMove = (e) => {
          screenPointer.x = (e.clientX / window.innerWidth) * 2 - 1;
          screenPointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
          lastPointerAt = timer.getElapsed();
        };

        const onResize = () => {
          const width = host.clientWidth || window.innerWidth;
          const height = host.clientHeight || window.innerHeight;
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
          renderer.setSize(width, height);
        };

        window.addEventListener('pointermove', onPointerMove, { passive: true });
        window.addEventListener('resize', onResize);

        renderer.setAnimationLoop(() => {
          if (document.hidden || disposed) return;

          timer.update();
          const delta = timer.getDelta();
          const elapsed = timer.getElapsed();

          renderer.compute(updateParticles);
          renderer.compute(spawnParticles);
          spawnIndex.value = (spawnIndex.value + nbToSpawn.value) % NB_PARTICLES;

          // Plan de raycast face caméra (remis à zéro à chaque frame :
          // applyEuler cumulatif comme dans le demo ferait dériver le plan)
          raycastPlane.normal.set(0, 0, 1).applyQuaternion(camera.quaternion);
          raycaster.setFromCamera(screenPointer, camera);
          raycaster.ray.intersectPlane(raycastPlane, scenePointer);

          // Graine : curseur si le pointeur est actif, sinon dérive de Lissajous
          if (elapsed - lastPointerAt > 2) {
            spawnTarget.set(
              Math.sin(elapsed * 0.42) * 3.6,
              Math.cos(elapsed * 0.3) * 2.2,
              Math.sin(elapsed * 0.18) * 1.4
            );
          } else {
            spawnTarget.copy(scenePointer);
          }

          previousSpawnPosition.value.copy(spawnPosition.value);
          spawnPosition.value.lerp(spawnTarget, 0.12);

          colorOffset.value += delta * colorRotationSpeed.value * timeScale.value;

          light.position.set(
            Math.sin(elapsed * 0.5) * 26,
            Math.cos(elapsed * 0.33) * 20,
            Math.sin(elapsed * 0.22) * 26
          );

          // Pas d'OrbitControls : dérive lente, sans interaction volée au formulaire
          camera.position.set(Math.sin(elapsed * 0.055) * 1.6, Math.cos(elapsed * 0.04) * 1.0, 10);
          camera.lookAt(0, 0, 0);

          renderPipeline.render();
        });

        teardown = () => {
          renderer.setAnimationLoop(null);
          window.removeEventListener('pointermove', onPointerMove);
          window.removeEventListener('resize', onResize);
          timer.disconnect();
          particleGeom.dispose();
          particleMaterial.dispose();
          linksGeom.dispose();
          linksMaterial.dispose();
          backgroundGeom.dispose();
          backgroundMaterial.dispose();
          renderer.dispose();
          if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
        };
      } catch (err) {
        console.warn('[login-particles] WebGPU indisponible, repli CSS :', err?.message || err);
        if (timer) timer.disconnect();
        if (renderer) renderer.dispose();
        if (renderer?.domElement?.parentNode === host) host.removeChild(renderer.domElement);
        setUnsupported(true);
      }
    })();

    return () => {
      disposed = true;
      if (teardown) teardown();
    };
  }, []);

  return (
    <div ref={hostRef} aria-hidden="true" className="absolute inset-0 z-0 overflow-hidden bg-[#07090d]">
      {/* Repli toujours dessiné sous le canvas : si le canvas est opaque il le masque */}
      <FallbackBackdrop animated={unsupported} />
    </div>
  );
}
