'use client';

import React from 'react';
import { Canvas } from '@react-three/fiber';
import { WebGPURenderer } from 'three/webgpu';
import { WebGLRenderer } from 'three';
import type { RaycasterParameters } from 'three';
import { OrbitControls } from '@react-three/drei';
import { useViewportStore } from '@/stores/viewport-store';
import CalmBg from './calm-bg';
import SceneContent from './scene-content';
import CameraController from './camera-controller';
import WorldEffects from './world-effects';
import { useRendererSettings } from '@/stores/world-store';
import AutoOrbitController from './auto-orbit-controller';
import { useSelectionStore } from '@/stores/selection-store';
import { useToolStore } from '@/stores/tool-store';
import { useActiveCameraBinding } from '../hooks/use-active-camera';
import AnimationSampler from '@/features/animation/components/animation-sampler';
import CameraAspectSync from './camera-aspect-sync';

// Runs inside Canvas to bind the R3F default camera to the active scene camera
function ActiveCameraBinding() {
  useActiveCameraBinding();
  return null;
}

const EditorViewport: React.FC = () => {
  const camera = useViewportStore((s) => s.camera);
  // activeCameraObjectId is consumed inside useActiveCameraBinding hook
  const shadingMode = useViewportStore((s) => s.shadingMode);
  const autoOrbitIntervalSec = useViewportStore((s) => s.autoOrbitIntervalSec ?? 0);
  const hasSelectedObject = useSelectionStore((s) => s.selection.viewMode === 'object' && s.selection.objectIds.length > 0);
  const renderer = useRendererSettings();
  const sculptStrokeActive = useToolStore((s) => s.sculptStrokeActive);
  // Camera binding runs inside Canvas via ActiveCameraBinding

  // Camera controller runs inside Canvas via component

  return (
    <div className="absolute inset-0">
      <Canvas
        gl={async (props) => {
          try {
            if ('gpu' in navigator) {
              const renderer = new WebGPURenderer(props as any);
              await renderer.init();
              return renderer;
            }
          } catch { }
          // Fallback to WebGL if WebGPU is unavailable
          return new WebGLRenderer(props as any);
        }}
        shadows={renderer.shadows && shadingMode === 'material'}
        camera={{
          fov: camera.fov,
          near: camera.near,
          far: camera.far,
          position: [camera.position.x, camera.position.y, camera.position.z],
        }}
        dpr={[0.2, 2]}
  // Slightly relaxed line thresholds so edge picking can register; actual selection uses a stricter pixel test
  raycaster={{ params: { Mesh: {}, LOD: {}, Points: {}, Sprite: {}, Line2: { threshold: 1.5 }, Line: { threshold: 1.5 } } as unknown as RaycasterParameters }}
      >
        <CalmBg />
  <ActiveCameraBinding />
  {/* Keep camera aspect matched to canvas size to avoid stretching */}
  <CameraAspectSync />
        {shadingMode !== 'material' && (
          <>
            {/* Headlight-style defaults for non-material modes; no shadows */}
            <ambientLight intensity={0.5} />
            <directionalLight position={[5, 8, 3]} intensity={0.8} />
          </>
        )}
  <CameraController />
        <AutoOrbitController />
  <OrbitControls
          makeDefault
          target={[camera.target.x, camera.target.y, camera.target.z]}
          dampingFactor={0.1}
          // Avoid camera inertia after sculpting by disabling inputs directly during strokes
          enabled={true}
          enableRotate={!sculptStrokeActive}
          enablePan={!sculptStrokeActive}
          enableZoom={!sculptStrokeActive}
          enableDamping={!sculptStrokeActive}
          autoRotate={Boolean(autoOrbitIntervalSec && hasSelectedObject) && !sculptStrokeActive}
          // Three.js OrbitControls uses a 60fps-based factor: angle += 2π/60 * autoRotateSpeed per frame
          // For one full rotation every N seconds: speed = 60 / N
          autoRotateSpeed={autoOrbitIntervalSec ? 60 / autoOrbitIntervalSec : 0}
  />
        <SceneContent />
        <WorldEffects />
  <AnimationSampler />
      </Canvas>
    </div>
  );
};

export default EditorViewport;
