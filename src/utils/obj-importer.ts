'use client';

// OBJ importer: uses Three.js OBJLoader and converts to our geometry format

import type { 
    Mesh as GMesh, 
    Vertex, 
    Face,
    SceneObject,
    Vector3 as GVec3 
} from '@/types/geometry';
import { createVertex, createFace, createMeshFromGeometry, vec3 } from '@/utils/geometry';
import { useGeometryStore } from '@/stores/geometry-store';
import { useSceneStore } from '@/stores/scene-store';
import { nanoid } from 'nanoid';

export interface OBJImportSummary {
    rootGroupId: string;
    createdObjectIds: string[];
    createdMeshIds: string[];
    warnings: string[];
}

function toVec3(x: number, y: number, z: number): GVec3 { 
    return { x, y, z }; 
}

/** Build our geometry buffers from a THREE.BufferGeometry (same as GLTF importer) */
function buildGeometryFromThreeGeometry(geo: any): { vertices: Vertex[]; faces: Face[] } {
    const pos = geo.getAttribute('position');
    if (!pos) throw new Error('Mesh has no position attribute');
    
    // OBJLoader might not compute normals automatically
    if (!geo.getAttribute('normal')) {
        geo.computeVertexNormals();
    }
    
    const nor = geo.getAttribute('normal');
    const uv = geo.getAttribute('uv');
    
    const vertices: Vertex[] = [];
    const vidMap: number[] = []; // three vertex index -> vertices index
    const vcount = pos.count;
    
    for (let i = 0; i < vcount; i++) {
        const p = toVec3(pos.getX(i), pos.getY(i), pos.getZ(i));
        const n = nor ? toVec3(nor.getX(i), nor.getY(i), nor.getZ(i)) : toVec3(0, 1, 0);
        const u = uv ? { x: uv.getX(i), y: uv.getY(i) } : { x: 0, y: 0 };
        const v = createVertex(p, n, u);
        vidMap[i] = vertices.push(v) - 1;
    }
    
    const faces: Face[] = [];
    if (geo.index) {
        const idx = geo.index;
        const triCount = Math.floor(idx.count / 3);
        for (let t = 0; t < triCount; t++) {
            const a = idx.getX(3 * t + 0);
            const b = idx.getX(3 * t + 1);
            const c = idx.getX(3 * t + 2);
            const fa = vertices[vidMap[a]].id;
            const fb = vertices[vidMap[b]].id;
            const fc = vertices[vidMap[c]].id;
            faces.push(createFace([fa, fb, fc]));
        }
    } else {
        const triCount = Math.floor(vcount / 3);
        for (let t = 0; t < triCount; t++) {
            const a = 3 * t + 0;
            const b = 3 * t + 1;
            const c = 3 * t + 2;
            const fa = vertices[vidMap[a]].id;
            const fb = vertices[vidMap[b]].id;
            const fc = vertices[vidMap[c]].id;
            faces.push(createFace([fa, fb, fc]));
        }
    }
    
    return { vertices, faces };
}

/** Convert a THREE.Object3D transform to our Transform */
function transformFromObject3D(obj: any): SceneObject['transform'] {
    return {
        position: vec3(obj.position.x, obj.position.y, obj.position.z),
        rotation: vec3(obj.rotation.x, obj.rotation.y, obj.rotation.z),
        scale: vec3(obj.scale.x, obj.scale.y, obj.scale.z),
    };
}

/** Import an OBJ file using Three.js OBJLoader */
export async function importOBJFile(file: File): Promise<OBJImportSummary> {
    const warnings: string[] = [];
    const geom = useGeometryStore.getState();
    const scene = useSceneStore.getState();
    
    const nameBase = file.name.replace(/\.obj$/i, '');
    const rootGroupId = scene.createGroupObject(`Imported ${nameBase}`);
    
    // Add root group to created objects so it's visible
    const createdObjectIds: string[] = [rootGroupId];
    const createdMeshIds: string[] = [];
    
    // Dynamically import Three.js OBJLoader
    const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
    const loader = new OBJLoader();
    
    // Read file content
    const content = await file.text();
    
    // Parse OBJ with Three.js
    const group = loader.parse(content);
    
    console.log('OBJ Loader result:', group);
    console.log('Children count:', group.children?.length);
    
    // Recursively process Three.js scene graph
    const processObject = (obj: any, parentId: string) => {
        console.log('Processing object:', obj.type, obj.name, obj);
        
        if (obj.type === 'Mesh' && obj.geometry) {
            try {
                console.log('Geometry attributes:', {
                    position: obj.geometry.getAttribute('position')?.count,
                    normal: obj.geometry.getAttribute('normal')?.count,
                    uv: obj.geometry.getAttribute('uv')?.count,
                    index: obj.geometry.index?.count
                });
                
                // Convert Three.js geometry to our format
                const { vertices, faces } = buildGeometryFromThreeGeometry(obj.geometry);
                
                console.log('Converted geometry:', {
                    vertices: vertices.length,
                    faces: faces.length
                });
                
                // Create mesh in our geometry store
                const meshName = obj.name || 'Mesh';
                const mesh = createMeshFromGeometry(meshName, vertices, faces);
                const meshId = geom.addMesh(mesh);
                createdMeshIds.push(meshId);
                
                console.log('Created mesh:', meshId, mesh);
                
                // Create scene object for this mesh
                const objId = scene.createMeshObject(mesh.name, meshId);
                scene.setParent(objId, parentId);
                
                // Apply transform
                const transform = transformFromObject3D(obj);
                scene.setTransform(objId, transform);
                
                createdObjectIds.push(objId);
                console.log('Created object:', objId);
            } catch (err) {
                console.error('Error importing mesh:', err);
                warnings.push(`Failed to import mesh ${obj.name}: ${err}`);
            }
        } else if (obj.type === 'Group') {
            // Create group in our scene
            const groupId = scene.createGroupObject(obj.name || 'Group');
            scene.setParent(groupId, parentId);
            
            // Apply transform
            const transform = transformFromObject3D(obj);
            scene.setTransform(groupId, transform);
            
            createdObjectIds.push(groupId);
            
            // Process children
            if (obj.children) {
                for (const child of obj.children) {
                    processObject(child, groupId);
                }
            }
        }
        
        // Process any children that aren't handled above
        if (obj.children && obj.type !== 'Group') {
            for (const child of obj.children) {
                processObject(child, parentId);
            }
        }
    };
    
    // Process the root group
    if (group.children && group.children.length > 0) {
        for (const child of group.children) {
            processObject(child, rootGroupId);
        }
    } else {
        // Sometimes OBJLoader returns the mesh directly as the group
        if (group.type === 'Mesh' && group.geometry) {
            processObject(group, rootGroupId);
        } else {
            warnings.push('OBJLoader returned unexpected structure');
            console.error('Unexpected OBJ structure:', group);
        }
    }
    
    // If no meshes were imported, add a warning
    if (createdMeshIds.length === 0) {
        warnings.push('No meshes found in OBJ file');
    }
    
    return {
        rootGroupId,
        createdObjectIds,
        createdMeshIds,
        warnings
    };
}

/** Open file dialog and import selected OBJ file */
export function openOBJImportDialog(
    onSuccess: (summary: OBJImportSummary) => void,
    onError: (error: Error) => void
) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.obj';
    
    input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        
        // Basic validation
        if (!file.name.toLowerCase().endsWith('.obj')) {
            onError(new Error('Please select an OBJ file'));
            return;
        }
        
        // Size limit (100MB)
        if (file.size > 100 * 1024 * 1024) {
            onError(new Error('File too large (max 100MB)'));
            return;
        }
        
        try {
            const summary = await importOBJFile(file);
            
            // Report warnings if any
            if (summary.warnings.length > 0) {
                console.warn('OBJ import warnings:', summary.warnings);
            }
            
            onSuccess(summary);
        } catch (err) {
            onError(err instanceof Error ? err : new Error(String(err)));
        }
    };
    
    input.click();
}