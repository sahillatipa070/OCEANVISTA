import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Line, Html, Edges } from '@react-three/drei';
import * as THREE from 'three';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useOceanStore } from '../store/oceanStore';

const API = 'https://oceanvista-backend.onrender.com';

const W = 10;
const H = 6;
const D = 7;

const clamp = (n: number, a: number, b: number) =>
  Math.max(a, Math.min(b, n));

const depthY = (depth: number) =>
  H / 2 - (clamp(depth, 0, 2000) / 2000) * H;

function palette(t: number, scale: string) {
  const sets: any = {
    Turbo: [
      '#30123b',
      '#4145ab',
      '#20b7d2',
      '#30c979',
      '#b8df2c',
      '#ffe11a',
      '#ff7a16',
      '#d7191c'
    ],
    Viridis: [
      '#440154',
      '#482878',
      '#31688e',
      '#26828e',
      '#35b779',
      '#b5de2b',
      '#fde725'
    ],
    Plasma: [
      '#0d0887',
      '#6a00a8',
      '#b12a90',
      '#e16462',
      '#fca636',
      '#f0f921'
    ],
    Inferno: [
      '#000004',
      '#420a68',
      '#932667',
      '#dd513a',
      '#fca50a',
      '#fcffa4'
    ],
    'Cool Warm': [
      '#3b4cc0',
      '#6aaed6',
      '#b9d6e8',
      '#f7f7f7',
      '#f7b89c',
      '#e26952',
      '#b40426'
    ]
  };

  const a = sets[scale] || sets.Turbo;

  const x = clamp(t, 0, 0.99999) * (a.length - 1);
  const i = Math.floor(x);

  return new THREE.Color(a[i]).lerp(
    new THREE.Color(a[Math.min(i + 1, a.length - 1)]),
    x - i
  );
}

class SceneErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { bad: boolean }
> {
  state = { bad: false };

  static getDerivedStateFromError() {
    return { bad: true };
  }

  render() {
    return this.state.bad ? (
      <div className="scene-error">
        3D renderer recovered safely. Choose another mode or dataset.
      </div>
    ) : (
      this.props.children
    );
  }
}

/* =========================
   WATER SURFACE
========================= */

function WaterSurface() {
  const ref = useRef<THREE.Mesh>(null!);

  const geo = useMemo(
    () => new THREE.PlaneGeometry(W, D, 72, 52),
    []
  );

  useFrame(({ clock }) => {
    const p = geo.attributes.position as THREE.BufferAttribute;
    const t = clock.elapsedTime;

    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const z = p.getY(i);

      p.setZ(
        i,
        0.07 * Math.sin(x * 1.45 + t * 0.9) +
          0.04 * Math.cos(z * 2.1 - t * 0.6) +
          0.02 * Math.sin((x + z) * 3.1 + t * 0.4)
      );
    }

    p.needsUpdate = true;

    if (Math.floor(t * 8) % 2 === 0) {
      geo.computeVertexNormals();
    }
  });

  return (
    <mesh
      ref={ref}
      geometry={geo}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, H / 2 + 0.03, 0]}
    >
      <meshPhysicalMaterial
        color="#07567a"
        emissive="#04233a"
        emissiveIntensity={0.65}
        roughness={0.1}
        metalness={0.78}
        transparent
        opacity={0.93}
      />
    </mesh>
  );
}

/* =========================
   LOAD REAL DATA
========================= */

function RealField() {
  const s = useOceanStore();

  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!s.modelDataset?.id) {
      s.set('modelField', null);
      return;
    }

    let dead = false;
    const controller = new AbortController();

    async function loadField() {
      try {
        setLoading(true);
        setErr('');

        const url =
          `${API}/api/datasets/` +
          `${encodeURIComponent(s.modelDataset!.id)}` +
          `/field?variable=${encodeURIComponent(s.variable)}` +
          `&time_index=${s.timeIndex}`;

        console.log('Loading real field:', url);

        const response = await fetch(url, {
          signal: controller.signal
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.detail || 'Field unavailable');
        }

        if (dead) return;

        if (Array.isArray(data.values) && data.values.length > 0) {
          /*
            IMPORTANT:
            Set a completely new object so React/Three
            definitely updates the geometry.
          */
          s.set('modelField', {
            ...data,
            values: [...data.values]
          });

          if (
            Number.isFinite(data.min) &&
            Number.isFinite(data.max) &&
            data.max > data.min
          ) {
            s.set('colorMin', data.min);
            s.set('colorMax', data.max);
          }

          /*
            REAL TIMES FROM THE UPLOADED DATASET
          */
          if (
            Array.isArray(data.times) &&
            data.times.length > 0
          ) {
            s.set(
              'dataTimes',
              data.times.map((x: any) => String(x))
            );

            /*
              Prevent invalid time index when
              a new dataset has fewer times.
            */
            if (s.timeIndex >= data.times.length) {
              s.set('timeIndex', 0);
            }
          } else {
            s.set('dataTimes', []);
          }

          console.log(
            'Loaded real field:',
            data.variable,
            'time:',
            data.time_index,
            'shape:',
            data.shape
          );
        } else {
          throw new Error(
            'The uploaded dataset returned no renderable values.'
          );
        }
      } catch (e: any) {
        if (e.name !== 'AbortError') {
          console.error('Field loading error:', e);

          if (!dead) {
            setErr(e.message || 'Unable to load field');
            s.set('modelField', null);
          }
        }
      } finally {
        if (!dead) {
          setLoading(false);
        }
      }
    }

    loadField();

    return () => {
      dead = true;
      controller.abort();
    };
  }, [
    s.modelDataset?.id,
    s.variable,
    s.timeIndex
  ]);

  if (loading) {
    return (
      <Html position={[0, 0, 0]}>
        <div className="scene-toast">
          Loading real data...
        </div>
      </Html>
    );
  }

  if (err) {
    return (
      <Html position={[0, 0, 0]}>
        <div className="scene-toast">
          Dataset field: {err}
        </div>
      </Html>
    );
  }

  return null;
}

/* =========================
   REAL 3D FIELD POINTS
========================= */

function FieldPoints() {
  const s = useOceanStore();
  const f = s.modelField;

  const geom = useMemo(() => {
    if (!f?.shape || !Array.isArray(f.values)) {
      return null;
    }

    /*
      Backend returns:

      a.shape[0] = nz = DEPTH
      a.shape[1] = ny = LATITUDE
      a.shape[2] = nx = LONGITUDE

      Values are flattened in C order:
      depth -> latitude -> longitude
    */

    const nz = Number(f.shape.nz);
    const ny = Number(f.shape.ny);
    const nx = Number(f.shape.nx);

    if (!nx || !ny || !nz) {
      return null;
    }

    if (nx * ny * nz !== f.values.length) {
      console.error(
        'Shape/value mismatch:',
        { nx, ny, nz },
        f.values.length
      );

      return null;
    }

    const positions = new Float32Array(
      f.values.length * 3
    );

    const colors = new Float32Array(
      f.values.length * 3
    );

    const lo = Number(s.colorMin);
    const hi = Math.max(
      lo + 1e-8,
      Number(s.colorMax)
    );

    let k = 0;

    /*
      Correct order:

      z = depth
      y = latitude
      x = longitude
    */

    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++, k++) {

          /*
            Longitude -> X
          */
          positions[3 * k] =
            (x / Math.max(1, nx - 1) - 0.5) * W;

          /*
            Depth -> vertical Y
          */
          positions[3 * k + 1] =
            H / 2 -
            (z / Math.max(1, nz - 1)) * H;

          /*
            Latitude -> Z
          */
          positions[3 * k + 2] =
            (y / Math.max(1, ny - 1) - 0.5) * D;

          let value = Number(f.values[k]);

          if (!Number.isFinite(value)) {
            value = lo;
          }

          let t = (value - lo) / (hi - lo);

          t = clamp(t, 0, 1);

          if (s.log) {
            t =
              Math.log1p(9 * t) /
              Math.log(10);
          }

          const c = palette(
            t,
            s.colorScale
          );

          colors[3 * k] = c.r;
          colors[3 * k + 1] = c.g;
          colors[3 * k + 2] = c.b;
        }
      }
    }

    const g = new THREE.BufferGeometry();

    g.setAttribute(
      'position',
      new THREE.BufferAttribute(
        positions,
        3
      )
    );

    g.setAttribute(
      'color',
      new THREE.BufferAttribute(
        colors,
        3
      )
    );

    return g;

  }, [
    f,
    s.colorScale,
    s.colorMin,
    s.colorMax,
    s.log
  ]);

  useEffect(() => {
    return () => {
      geom?.dispose();
    };
  }, [geom]);

  if (!geom) {
    return null;
  }

  return (
    <points
      key={`field-${f?.time_index}-${f?.dataset_id}`}
      geometry={geom}
      scale={[1, s.vertical, 1]}
    >
      <pointsMaterial
        size={0.11}
        vertexColors
        transparent
        opacity={Math.min(
          0.95,
          s.opacity * 0.9
        )}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  );
}

/* =========================
   FALLBACK VOLUME
========================= */

function FallbackVolume() {
  const s = useOceanStore();

  return (
    <group scale={[1, s.vertical, 1]}>
      {Array.from(
        { length: 42 },
        (_, i) => {
          const q = i / 41;

          /*
            Make fallback also react
            slightly to the selected time.
          */
          const timeOffset =
            ((s.timeIndex % 8) / 8) * 0.18;

          const warm =
            clamp(1 - q + timeOffset, 0, 1);

          const c = palette(
            warm,
            s.colorScale
          );

          return (
            <mesh
              key={`${i}-${s.timeIndex}`}
              position={[
                0,
                H / 2 - q * H,
                0
              ]}
              rotation={[
                -Math.PI / 2,
                0,
                0
              ]}
            >
              <planeGeometry
                args={[
                  W - 0.1,
                  D - 0.1,
                  1,
                  1
                ]}
              />

              <meshBasicMaterial
                color={c}
                transparent
                opacity={
                  (0.018 +
                    0.075 *
                      Math.sin(
                        q * Math.PI
                      )) *
                  s.opacity
                }
                depthWrite={false}
                side={
                  THREE.DoubleSide
                }
              />
            </mesh>
          );
        }
      )}
    </group>
  );
}

/* =========================
   OCEAN VOLUME
========================= */

function OceanVolume() {
  const s = useOceanStore();

  return (
    <group>
      <mesh
        scale={[
          1,
          s.vertical,
          1
        ]}
      >
        <boxGeometry
          args={[W, H, D]}
        />

        <meshPhysicalMaterial
          color="#0b4264"
          transparent
          opacity={0.055}
          depthWrite={false}
          side={THREE.DoubleSide}
        />

        <Edges
          color="#2c8ac0"
          transparent
          opacity={0.85}
        />
      </mesh>

      {s.layers[
        'Numerical Model'
      ] &&
        (s.modelField ? (
          <FieldPoints />
        ) : (
          <FallbackVolume />
        ))}

      <WaterSurface />
    </group>
  );
}

/* =========================
   ARGO FLOATS
========================= */

function Argo() {
  const s = useOceanStore();

  if (!s.layers['Argo Floats']) {
    return null;
  }

  const ids = [
    '2903671',
    '2904120',
    '2905214',
    '2906382'
  ];

  return (
    <group>
      {ids.map((id, i) => {
        const p: [
          number,
          number,
          number
        ] = [
          -3 + i * 2.05,
          (H / 2 - 0.08) *
            s.vertical,
          i % 2 ? 1 : -1
        ];

        const active =
          s.instrumentId === id;

        return (
          <group
            key={id}
            position={p}
            onClick={(e) => {
              e.stopPropagation();

              s.set(
                'instrument',
                'Argo Float'
              );

              s.set(
                'instrumentId',
                id
              );
            }}
          >
            <mesh>
              <sphereGeometry
                args={[
                  active
                    ? 0.19
                    : 0.12,
                  20,
                  20
                ]}
              />

              <meshStandardMaterial
                color={
                  active
                    ? '#d8f7ff'
                    : '#198bdf'
                }
                emissive="#0876b4"
                emissiveIntensity={
                  active
                    ? 2.4
                    : 0.8
                }
              />
            </mesh>

            <mesh
              position={[
                0,
                -1.55 *
                  s.vertical,
                0
              ]}
            >
              <cylinderGeometry
                args={[
                  0.02,
                  0.02,
                  3.1 *
                    s.vertical,
                  6
                ]}
              />

              <meshBasicMaterial
                color="#70dcff"
                transparent
                opacity={0.8}
              />
            </mesh>

            {active && (
              <Html
                position={[
                  0.32,
                  0.28,
                  0.1
                ]}
                distanceFactor={8}
              >
                <div className="scene-label">
                  <span>
                    Argo Float
                  </span>

                  <b>{id}</b>
                </div>
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
}

/* =========================
   GLIDER
========================= */

function Glider() {
  const s = useOceanStore();

  const r =
    useRef<THREE.Group>(null!);

  useFrame(({ clock }) => {
    if (r.current) {
      r.current.position.x =
        0.18 *
        Math.sin(
          clock.elapsedTime * 0.55
        );
    }
  });

  if (!s.layers.Gliders) {
    return null;
  }

  const pts = [
    [-2.2, 2.3, 2.4],
    [-1.5, 1.7, 1.8],
    [-0.7, 1, 1],
    [0.1, 0.25, 0.25],
    [0.9, -0.45, -0.45],
    [1.7, -1.1, -1.1],
    [2.5, -1.7, -1.7]
  ] as [
    number,
    number,
    number
  ][];

  return (
    <group
      ref={r}
      scale={[
        1,
        s.vertical,
        1
      ]}
      onClick={(e) => {
        e.stopPropagation();

        s.set(
          'instrument',
          'Glider'
        );

        s.set(
          'instrumentId',
          'SG678'
        );
      }}
    >
      <Line
        points={pts}
        color="#ef5cf5"
        lineWidth={2}
      />

      {pts.map((p, i) => (
        <mesh
          key={i}
          position={p}
        >
          <sphereGeometry
            args={[
              0.055,
              12,
              12
            ]}
          />

          <meshBasicMaterial
            color="#ff87f4"
          />
        </mesh>
      ))}

      <Html
        position={pts[1]}
        distanceFactor={8}
      >
        <div className="scene-label mag">
          <span>Glider</span>
          <b>SG678</b>
        </div>
      </Html>
    </group>
  );
}

/* =========================
   CURRENTS
========================= */

function Currents() {
  const s = useOceanStore();

  const g =
    useRef<THREE.Group>(null!);

  useFrame(({ clock }) => {
    if (g.current) {
      g.current.position.x =
        0.12 *
        Math.sin(
          clock.elapsedTime * 0.4
        );
    }
  });

  if (!s.layers.Currents) {
    return null;
  }

  return (
    <group ref={g}>
      {Array.from(
        { length: 28 },
        (_, i) => {
          const x =
            -4.5 +
            (i % 7) * 1.5;

          const z =
            -2.7 +
            Math.floor(i / 7) *
              1.75;

          const a =
            i * 0.73;

          const e: [
            number,
            number,
            number
          ] = [
            x +
              0.52 *
                Math.cos(a),
            2.7,
            z +
              0.52 *
                Math.sin(a)
          ];

          return (
            <group key={i}>
              <Line
                points={[
                  [x, 2.7, z],
                  e
                ]}
                color="#75dcff"
              />

              <mesh
                position={e}
                rotation={[
                  0,
                  a -
                    Math.PI / 2,
                  0
                ]}
              >
                <coneGeometry
                  args={[
                    0.07,
                    0.18,
                    7
                  ]}
                />

                <meshBasicMaterial
                  color="#b5efff"
                />
              </mesh>
            </group>
          );
        }
      )}
    </group>
  );
}

/* =========================
   DEPTH SLICE
========================= */

function DepthSlice() {
  const s = useOceanStore();

  if (
    s.mode !== 'Depth Slice'
  ) {
    return null;
  }

  const y =
    depthY(s.depth) *
    s.vertical;

  const t =
    s.modelField?.depth?.length
      ? clamp(
          s.depth /
            Math.max(
              1,
              Number(
                s.modelField.depth.at(
                  -1
                ) || 2000
              )
            ),
          0,
          1
        )
      : s.depth / 2000;

  return (
    <group
      position={[0, y, 0]}
    >
      <mesh
        rotation={[
          -Math.PI / 2,
          0,
          0
        ]}
      >
        <planeGeometry
          args={[
            W - 0.12,
            D - 0.12,
            42,
            30
          ]}
        />

        <meshBasicMaterial
          color={palette(
            1 - t,
            s.colorScale
          )}
          transparent
          opacity={0.72}
          side={THREE.DoubleSide}
        />
      </mesh>

      <Line
        points={[
          [-W / 2, 0, -D / 2],
          [W / 2, 0, -D / 2],
          [W / 2, 0, D / 2],
          [-W / 2, 0, D / 2],
          [-W / 2, 0, -D / 2]
        ]}
        color="#79eaff"
      />

      <Html
        position={[
          3.1,
          0.18,
          1.7
        ]}
        distanceFactor={8}
      >
        <div className="scene-label">
          <span>
            Depth Slice
          </span>

          <b>
            {s.depth === 0
              ? 'Surface'
              : `${s.depth} m`}
          </b>
        </div>
      </Html>
    </group>
  );
}

/* =========================
   ISOSURFACE
========================= */

function Isosurface() {
  const s = useOceanStore();

  const geo = useMemo(() => {
    const nx = 52;
    const ny = 36;

    const verts: number[] =
      [];

    for (
      let j = 0;
      j <= ny;
      j++
    ) {
      for (
        let i = 0;
        i <= nx;
        i++
      ) {
        const u =
          i / nx - 0.5;

        const v =
          j / ny - 0.5;

        const r =
          1 +
          0.18 *
            Math.sin(i * 0.31) *
            Math.cos(j * 0.23) +
          0.08 *
            Math.sin(
              (i + j) * 0.19
            );

        verts.push(
          u * 4.2 * r,
          v * 1.8 * r,
          0.28 *
            Math.sin(i * 0.22) +
            0.18 *
              Math.cos(
                j * 0.35
              ) +
            0.18 *
              Math.sin(
                (i - j) * 0.14
              )
        );
      }
    }

    const idx: number[] = [];

    for (
      let j = 0;
      j < ny;
      j++
    ) {
      for (
        let i = 0;
        i < nx;
        i++
      ) {
        const a =
          j * (nx + 1) + i;

        const b = a + 1;

        const c =
          a + (nx + 1);

        const d = c + 1;

        idx.push(
          a,
          c,
          b,
          b,
          c,
          d
        );
      }
    }

    const g =
      new THREE.BufferGeometry();

    g.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        verts,
        3
      )
    );

    g.setIndex(idx);

    g.computeVertexNormals();

    return g;
  }, []);

  useEffect(() => {
    return () => {
      geo.dispose();
    };
  }, [geo]);

  if (
    s.mode !== 'Isosurface'
  ) {
    return null;
  }

  return (
    <group
      scale={[
        1,
        s.vertical,
        1
      ]}
    >
      <mesh
        geometry={geo}
        position={[
          0,
          -1.65,
          0
        ]}
        rotation={[
          -0.2,
          0.45,
          0.08
        ]}
      >
        <meshStandardMaterial
          color="#27d590"
          emissive="#087850"
          emissiveIntensity={1.1}
          transparent
          opacity={0.78}
          roughness={0.35}
          metalness={0.12}
          side={THREE.DoubleSide}
        />
      </mesh>

      <Html
        position={[
          0,
          -0.6,
          0
        ]}
        distanceFactor={8}
      >
        <div className="scene-label iso">
          <span>
            Isosurface
          </span>

          <b>
            {s.variable.includes(
              'Temperature'
            )
              ? '20°C'
              : s.variable}
          </b>
        </div>
      </Html>
    </group>
  );
}

/* =========================
   BATHYMETRY
========================= */

function Bathymetry() {
  const s = useOceanStore();

  const geo = useMemo(() => {
    const g =
      new THREE.PlaneGeometry(
        W - 0.12,
        D - 0.12,
        64,
        46
      );

    const p =
      g.attributes
        .position as THREE.BufferAttribute;

    for (
      let i = 0;
      i < p.count;
      i++
    ) {
      const x = p.getX(i);
      const z = p.getY(i);

      const h =
        0.42 *
          Math.exp(
            -(
              (x + 1.2) ** 2 +
              (z - 0.1) ** 2
            ) / 3
          ) +
        0.22 *
          Math.sin(x * 1.3) *
          Math.cos(z * 1.8) +
        0.08 *
          Math.sin(z * 4);

      p.setZ(i, h);
    }

    p.needsUpdate = true;

    g.computeVertexNormals();

    return g;
  }, []);

  useEffect(() => {
    return () => {
      geo.dispose();
    };
  }, [geo]);

  if (!s.layers.Bathymetry) {
    return null;
  }

  return (
    <mesh
      geometry={geo}
      position={[
        0,
        -H / 2 *
          s.vertical +
          0.08,
        0
      ]}
      rotation={[
        -Math.PI / 2,
        0,
        0
      ]}
      scale={[
        1,
        s.vertical,
        1
      ]}
    >
      <meshStandardMaterial
        color="#0b5f63"
        emissive="#04383a"
        emissiveIntensity={0.75}
        roughness={0.82}
        transparent
        opacity={0.96}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

/* =========================
   MEASUREMENT
========================= */

function MeasureLayer() {
  const s = useOceanStore();

  const p =
    s.measurePoints;

  if (p.length < 2) {
    return null;
  }

  return (
    <>
      <Line
        points={[
          p[0],
          p[1]
        ]}
        color="#facc15"
        lineWidth={2}
      />

      {p.map((x, i) => (
        <mesh
          key={i}
          position={x}
        >
          <sphereGeometry
            args={[
              0.1,
              12,
              12
            ]}
          />

          <meshBasicMaterial
            color="#facc15"
          />
        </mesh>
      ))}
    </>
  );
}

function ClickPlane() {
  const s = useOceanStore();

  return (
    <mesh
      visible={
        s.measureMode
      }
      rotation={[
        -Math.PI / 2,
        0,
        0
      ]}
      position={[0, 0, 0]}
      onClick={(e) => {
        if (!s.measureMode) {
          return;
        }

        e.stopPropagation();

        const p: [
          number,
          number,
          number
        ] = [
          e.point.x,
          e.point.y,
          e.point.z
        ];

        s.set(
          'measurePoints',
          s.measurePoints.length >= 2
            ? [p]
            : [
                ...s.measurePoints,
                p
              ] as any
        );
      }}
    >
      <planeGeometry
        args={[28, 28]}
      />

      <meshBasicMaterial
        transparent
        opacity={0}
      />
    </mesh>
  );
}

/* =========================
   SCENE
========================= */

function SceneCanvas() {
  return (
    <Canvas
      camera={{
        position: [
          10.7,
          8.5,
          11.5
        ],
        fov: 39
      }}
      dpr={[1, 1.5]}
      gl={{
        preserveDrawingBuffer: true,
        antialias: true
      }}
    >
      <color
        attach="background"
        args={['#020812']}
      />

      <fog
        attach="fog"
        args={[
          '#020812',
          13,
          30
        ]}
      />

      <ambientLight
        intensity={0.65}
      />

      <directionalLight
        position={[5, 9, 6]}
        intensity={1.55}
      />

      <pointLight
        position={[
          -4,
          3,
          3
        ]}
        intensity={1}
        color="#075b99"
      />

      <RealField />

      <OceanVolume />

      <Bathymetry />

      <Argo />

      <Glider />

      <Currents />

      <DepthSlice />

      <Isosurface />

      <MeasureLayer />

      <ClickPlane />

      <OrbitControls
        enableDamping
        dampingFactor={0.075}
        maxDistance={25}
        minDistance={6}
      />
    </Canvas>
  );
}

/* =========================
   EXPORT
========================= */

export default function OceanScene() {
  return (
    <div className="scene">
      <SceneErrorBoundary>
        <SceneCanvas />
      </SceneErrorBoundary>

      <div className="geo-longitudes">
        <span>84°E</span>
        <span>86°E</span>
        <span>88°E</span>
        <span>90°E</span>
      </div>

      <div className="geo-latitudes">
        <span>16°N</span>
        <span>14°N</span>
        <span>12°N</span>
      </div>

      <div className="geo-depth">
        <span>0 m</span>
        <span>100 m</span>
        <span>200 m</span>
        <span>500 m</span>
        <span>1000 m</span>
        <span>2000 m</span>
      </div>

      <div className="endpoint a">
        A
      </div>

      <div className="endpoint b">
        B
      </div>

      <div className="cross">
        <span>
          Cross Section
        </span>

        <b>
          A ───── B
        </b>
      </div>

      <div className="scene-hint">
        Drag to rotate · Scroll to zoom · Right drag to pan
      </div>
    </div>
  );
}