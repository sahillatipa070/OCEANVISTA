import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import * as THREE from 'three';

import {
  Canvas,
  useFrame,
} from '@react-three/fiber';

import {
  OrbitControls,
  Line,
  Html,
  Edges,
} from '@react-three/drei';

import { useOceanStore } from '../store/oceanStore';


/* ============================================================
   CONFIGURATION
============================================================ */

const API =
  'https://oceanvista-backend.onrender.com';

const W = 10;
const H = 6;
const D = 7;

const MAX_FIELD_POINTS = 140000;
const MAX_SLICE_POINTS = 30000;


/* ============================================================
   HELPERS
============================================================ */

const clamp = (
  n: number,
  min: number,
  max: number
) =>
  Math.max(
    min,
    Math.min(max, n)
  );


/* ============================================================
   SCIENTIFIC COLOR PALETTES
============================================================ */

function palette(
  t: number,
  scale: string
) {
  const palettes: Record<
    string,
    string[]
  > = {
    Turbo: [
      '#30123b',
      '#4145ab',
      '#20b7d2',
      '#22d779',
      '#c6f51c',
      '#ffe11a',
      '#ff7a16',
      '#e11013',
    ],

    Viridis: [
      '#440154',
      '#482878',
      '#31688e',
      '#26828e',
      '#35b779',
      '#b5de2b',
      '#fde725',
    ],

    Plasma: [
      '#0d0887',
      '#6a00a8',
      '#b12a90',
      '#e16462',
      '#fca636',
      '#f0f921',
    ],

    Inferno: [
      '#000004',
      '#420a68',
      '#932667',
      '#dd513a',
      '#fca50a',
      '#fcffa4',
    ],

    'Cool Warm': [
      '#3b4cc0',
      '#6aaed6',
      '#b9d6e8',
      '#f7f7f7',
      '#f7b89c',
      '#e26952',
      '#b40426',
    ],
  };

  const colors =
    palettes[scale] ||
    palettes.Turbo;

  const value =
    clamp(t, 0, 1);

  const scaled =
    value *
    (colors.length - 1);

  const index =
    Math.floor(scaled);

  const fraction =
    scaled - index;

  const a =
    new THREE.Color(
      colors[index]
    );

  const b =
    new THREE.Color(
      colors[
        Math.min(
          index + 1,
          colors.length - 1
        )
      ]
    );

  return a.lerp(
    b,
    fraction
  );
}


/* ============================================================
   ERROR BOUNDARY
============================================================ */

class SceneErrorBoundary extends React.Component<
  {
    children: React.ReactNode;
  },
  {
    hasError: boolean;
  }
> {
  state = {
    hasError: false,
  };

  static getDerivedStateFromError() {
    return {
      hasError: true,
    };
  }

  componentDidCatch(
    error: Error
  ) {
    console.error(
      'OceanScene error:',
      error
    );
  }

  render() {
    if (
      this.state.hasError
    ) {
      return (
        <div
          style={{
            width: '100%',
            height: '100%',
            minHeight: '500px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#020812',
            color: '#9edcff',
            fontSize: '14px',
          }}
        >
          3D renderer encountered an error.
          Please change the visualization mode.
        </div>
      );
    }

    return this.props.children;
  }
}


/* ============================================================
   WATER SURFACE
============================================================ */

function WaterSurface() {
  const geometry =
    useMemo(() => {
      return new THREE.PlaneGeometry(
        W,
        D,
        64,
        48
      );
    }, []);

  const lastNormalUpdate =
    useRef(0);


  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);


  useFrame(({ clock }) => {
    const positions =
      geometry.attributes
        .position as THREE.BufferAttribute;

    const time =
      clock.elapsedTime;


    for (
      let i = 0;
      i < positions.count;
      i++
    ) {
      const x =
        positions.getX(i);

      const z =
        positions.getY(i);

      const wave =
        0.055 *
          Math.sin(
            x * 1.45 +
            time * 0.9
          ) +
        0.035 *
          Math.cos(
            z * 2.1 -
            time * 0.6
          ) +
        0.02 *
          Math.sin(
            (x + z) * 3.1 +
            time * 0.4
          );

      positions.setZ(
        i,
        wave
      );
    }


    positions.needsUpdate =
      true;


    if (
      time -
        lastNormalUpdate.current >
      0.2
    ) {
      geometry.computeVertexNormals();

      lastNormalUpdate.current =
        time;
    }
  });


  return (
    <mesh
      geometry={geometry}
      rotation={[
        -Math.PI / 2,
        0,
        0,
      ]}
      position={[
        0,
        H / 2 + 0.04,
        0,
      ]}
    >
      <meshPhysicalMaterial
        color="#07567a"
        emissive="#04233a"
        emissiveIntensity={0.45}
        roughness={0.12}
        metalness={0.72}
        transparent
        opacity={0.68}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}


/* ============================================================
   REAL DATA LOADER
============================================================ */

function RealFieldLoader() {
  const modelDataset =
    useOceanStore(
      (state) =>
        state.modelDataset
    );

  const variable =
    useOceanStore(
      (state) =>
        state.variable
    );

  const timeIndex =
    useOceanStore(
      (state) =>
        state.timeIndex
    );

  const setStore =
    useOceanStore(
      (state) =>
        state.set
    );


  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState('');


  useEffect(() => {
    if (
      !modelDataset?.id
    ) {
      setStore(
        'modelField',
        null
      );

      return;
    }


    let cancelled =
      false;

    const controller =
      new AbortController();


    async function loadField() {
      try {
        setLoading(true);

        setError('');


        const url =
          `${API}/api/datasets/` +
          `${encodeURIComponent(
            modelDataset.id
          )}` +
          `/field?variable=${encodeURIComponent(
            variable
          )}` +
          `&time_index=${timeIndex}`;


        console.log(
          'Loading field:',
          url
        );


        const response =
          await fetch(
            url,
            {
              signal:
                controller.signal,
            }
          );


        let data: any;

        try {
          data =
            await response.json();
        } catch {
          throw new Error(
            'Backend returned an invalid response.'
          );
        }


        if (!response.ok) {
          throw new Error(
            data?.detail ||
            `Field request failed (${response.status})`
          );
        }


        if (cancelled) {
          return;
        }


        if (
          !Array.isArray(
            data.values
          ) ||
          data.values.length === 0
        ) {
          throw new Error(
            'The uploaded dataset returned no renderable values.'
          );
        }


        setStore(
          'modelField',
          {
            ...data,
            values: [
              ...data.values,
            ],
          }
        );


        if (
          Number.isFinite(
            Number(data.min)
          ) &&
          Number.isFinite(
            Number(data.max)
          ) &&
          Number(data.max) >
            Number(data.min)
        ) {
          setStore(
            'colorMin',
            Number(data.min)
          );

          setStore(
            'colorMax',
            Number(data.max)
          );
        }


        if (
          Array.isArray(
            data.times
          ) &&
          data.times.length > 0
        ) {
          const times =
            data.times.map(
              (item: unknown) =>
                String(item)
            );

          setStore(
            'dataTimes',
            times
          );


          if (
            timeIndex >=
            times.length
          ) {
            setStore(
              'timeIndex',
              0
            );
          }
        } else {
          setStore(
            'dataTimes',
            []
          );
        }


        console.log(
          'Real field loaded:',
          data
        );

      } catch (err: any) {
        if (
          err?.name ===
          'AbortError'
        ) {
          return;
        }


        console.error(
          'Field loading error:',
          err
        );


        if (!cancelled) {
          setError(
            err?.message ||
            'Unable to load dataset field.'
          );

          setStore(
            'modelField',
            null
          );
        }

      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }


    loadField();


    return () => {
      cancelled = true;

      controller.abort();
    };

  }, [
    modelDataset?.id,
    variable,
    timeIndex,
    setStore,
  ]);


  if (loading) {
    return (
      <Html position={[0, 0, 0]}>
        <div className="scene-toast">
          Loading scientific data...
        </div>
      </Html>
    );
  }


  if (error) {
    return (
      <Html position={[0, 0, 0]}>
        <div className="scene-toast">
          Dataset error: {error}
        </div>
      </Html>
    );
  }


  return null;
}


/* ============================================================
   REAL FIELD POINTS
============================================================ */

function FieldPoints() {
  const modelField =
    useOceanStore(
      (state) =>
        state.modelField
    );

  const mode =
    useOceanStore(
      (state) =>
        state.mode
    );

  const vertical =
    useOceanStore(
      (state) =>
        state.vertical
    );

  const opacity =
    useOceanStore(
      (state) =>
        state.opacity
    );

  const colorScale =
    useOceanStore(
      (state) =>
        state.colorScale
    );

  const colorMin =
    useOceanStore(
      (state) =>
        state.colorMin
    );

  const colorMax =
    useOceanStore(
      (state) =>
        state.colorMax
    );

  const log =
    useOceanStore(
      (state) =>
        state.log
    );


  const geometry =
    useMemo(() => {
      const field =
        modelField;

      if (
        !field?.shape ||
        !Array.isArray(
          field.values
        )
      ) {
        return null;
      }


      const nx =
        Number(
          field.shape.nx
        );

      const ny =
        Number(
          field.shape.ny
        );

      const nz =
        Number(
          field.shape.nz
        );


      if (
        !nx ||
        !ny ||
        !nz
      ) {
        return null;
      }


      const expected =
        nx * ny * nz;


      if (
        field.values.length <
        expected
      ) {
        console.error(
          'Field shape/value mismatch:',
          {
            nx,
            ny,
            nz,
            values:
              field.values.length,
          }
        );

        return null;
      }


      const samplingStep =
        expected >
        MAX_FIELD_POINTS
          ? Math.ceil(
              Math.pow(
                expected /
                  MAX_FIELD_POINTS,
                1 / 3
              )
            )
          : 1;


      const positions: number[] =
        [];

      const colors: number[] =
        [];


      const dataMin =
        Number.isFinite(
          Number(field.min)
        )
          ? Number(field.min)
          : colorMin;


      const dataMax =
        Number.isFinite(
          Number(field.max)
        )
          ? Number(field.max)
          : colorMax;


      const lo =
        Number.isFinite(
          Number(colorMin)
        )
          ? Number(colorMin)
          : Number(dataMin);


      const hi =
        Number.isFinite(
          Number(colorMax)
        ) &&
        Number(colorMax) > lo
          ? Number(colorMax)
          : Math.max(
              lo + 1e-8,
              Number(dataMax)
            );


      const range =
        Math.max(
          1e-8,
          hi - lo
        );


      const isoValue =
        lo +
        range * 0.58;


      const isoTolerance =
        Math.max(
          range * 0.04,
          1e-8
        );


      for (
        let z = 0;
        z < nz;
        z += samplingStep
      ) {
        for (
          let y = 0;
          y < ny;
          y += samplingStep
        ) {
          for (
            let x = 0;
            x < nx;
            x += samplingStep
          ) {
            const index =
              z * ny * nx +
              y * nx +
              x;


            const value =
              Number(
                field.values[index]
              );


            if (
              !Number.isFinite(
                value
              )
            ) {
              continue;
            }


            if (
              mode ===
                'Isosurface' &&
              Math.abs(
                value -
                isoValue
              ) >
                isoTolerance
            ) {
              continue;
            }


            let t =
              (
                value -
                lo
              ) /
              range;


            t =
              clamp(
                t,
                0,
                1
              );


            if (log) {
              t =
                Math.log1p(
                  9 * t
                ) /
                Math.log(10);
            }


            const color =
              palette(
                t,
                colorScale
              );


            const px =
              (
                x /
                  Math.max(
                    1,
                    nx - 1
                  ) -
                0.5
              ) *
              W;


            const py =
              H / 2 -
              (
                z /
                Math.max(
                  1,
                  nz - 1
                )
              ) *
              H;


            const pz =
              (
                y /
                  Math.max(
                    1,
                    ny - 1
                  ) -
                0.5
              ) *
              D;


            positions.push(
              px,
              py,
              pz
            );


            colors.push(
              color.r,
              color.g,
              color.b
            );
          }
        }
      }


      if (
        positions.length === 0
      ) {
        return null;
      }


      const result =
        new THREE.BufferGeometry();


      result.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
          positions,
          3
        )
      );


      result.setAttribute(
        'color',
        new THREE.Float32BufferAttribute(
          colors,
          3
        )
      );


      result.computeBoundingSphere();


      return result;

    }, [
      modelField,
      mode,
      colorScale,
      colorMin,
      colorMax,
      log,
    ]);


  useEffect(() => {
    return () => {
      geometry?.dispose();
    };
  }, [geometry]);


  if (!geometry) {
    return null;
  }


  return (
    <points
      key={
        `field-${
          modelField?.dataset_id ||
          'data'
        }-${
          modelField?.time_index ||
          0
        }-${mode}`
      }
      geometry={geometry}
      scale={[
        1,
        vertical,
        1,
      ]}
    >
      <pointsMaterial
        size={
          mode ===
          'Isosurface'
            ? 0.14
            : 0.1
        }
        vertexColors
        transparent
        opacity={
          mode ===
          'Isosurface'
            ? Math.min(
                0.92,
                opacity
              )
            : Math.min(
                0.88,
                opacity * 0.88
              )
        }
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  );
}


/* ============================================================
   FALLBACK DEMO VOLUME
============================================================ */

function FallbackVolume() {
  const vertical =
    useOceanStore(
      (state) =>
        state.vertical
    );

  const opacity =
    useOceanStore(
      (state) =>
        state.opacity
    );

  const colorScale =
    useOceanStore(
      (state) =>
        state.colorScale
    );

  const timeIndex =
    useOceanStore(
      (state) =>
        state.timeIndex
    );


  return (
    <group
      scale={[
        1,
        vertical,
        1,
      ]}
    >
      {Array.from(
        {
          length: 38,
        },
        (_, index) => {
          const q =
            index / 37;

          const timeOffset =
            (
              timeIndex %
              8
            ) /
            8 *
            0.16;

          const t =
            clamp(
              1 -
              q +
              timeOffset,
              0,
              1
            );

          const color =
            palette(
              t,
              colorScale
            );


          return (
            <mesh
              key={
                `fallback-${index}-${timeIndex}`
              }
              position={[
                0,
                H / 2 -
                  q * H,
                0,
              ]}
              rotation={[
                -Math.PI / 2,
                0,
                0,
              ]}
            >
              <planeGeometry
                args={[
                  W - 0.15,
                  D - 0.15,
                ]}
              />

              <meshBasicMaterial
                color={color}
                transparent
                opacity={
                  (
                    0.015 +
                    0.06 *
                      Math.sin(
                        q *
                        Math.PI
                      )
                  ) *
                  opacity
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


/* ============================================================
   OCEAN VOLUME
============================================================ */

function OceanVolume() {
  const layers =
    useOceanStore(
      (state) =>
        state.layers
    );

  const modelField =
    useOceanStore(
      (state) =>
        state.modelField
    );

  const mode =
    useOceanStore(
      (state) =>
        state.mode
    );

  const vertical =
    useOceanStore(
      (state) =>
        state.vertical
    );


  return (
    <group>

      {/* Scientific volume boundary */}

      <mesh
        scale={[
          1,
          vertical,
          1,
        ]}
      >
        <boxGeometry
          args={[
            W,
            H,
            D,
          ]}
        />

        <meshPhysicalMaterial
          color="#075078"
          transparent
          opacity={0.025}
          depthWrite={false}
          side={
            THREE.DoubleSide
          }
        />

        <Edges
          color="#2786b5"
          transparent
          opacity={0.75}
        />
      </mesh>


      {/* Numerical model */}

      {layers[
        'Numerical Model'
      ] &&
        mode !==
          'Depth Slice' &&
        (
          modelField
            ? <FieldPoints />
            : <FallbackVolume />
        )}


      {/* Main ocean surface */}

      <WaterSurface />

    </group>
  );
}


/* ============================================================
   ARGO FLOATS
============================================================ */

function Argo() {
  const layers =
    useOceanStore(
      (state) =>
        state.layers
    );

  const instrumentId =
    useOceanStore(
      (state) =>
        state.instrumentId
    );

  const vertical =
    useOceanStore(
      (state) =>
        state.vertical
    );

  const setStore =
    useOceanStore(
      (state) =>
        state.set
    );


  if (
    !layers[
      'Argo Floats'
    ]
  ) {
    return null;
  }


  const ids = [
    '2903671',
    '2904120',
    '2905214',
    '2906382',
  ];


  return (
    <group>
      {ids.map(
        (
          id,
          index
        ) => {
          const active =
            instrumentId === id;

          const x =
            -3.2 +
            index * 2.1;

          const z =
            index % 2 === 0
              ? -1.1
              : 1.05;


          return (
            <group
              key={id}
              position={[
                x,
                (
                  H / 2 -
                  0.1
                ) *
                  vertical,
                z,
              ]}
              onClick={(
                event
              ) => {
                event.stopPropagation();

                setStore(
                  'instrument',
                  'Argo Float'
                );

                setStore(
                  'instrumentId',
                  id
                );
              }}
            >
              <mesh>
                <sphereGeometry
                  args={[
                    active
                      ? 0.18
                      : 0.12,
                    18,
                    18,
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
                      ? 1.6
                      : 0.55
                  }
                />
              </mesh>


              <Line
                points={[
                  [
                    0,
                    0,
                    0,
                  ],
                  [
                    0,
                    -3.2 *
                      vertical,
                    0,
                  ],
                ]}
                color="#70dcff"
                transparent
                opacity={0.75}
                lineWidth={1}
              />


              {active && (
                <Html
                  position={[
                    0.28,
                    0.28,
                    0.1,
                  ]}
                  distanceFactor={8}
                >
                  <div className="scene-label">
                    <span>
                      Argo Float
                    </span>

                    <b>
                      {id}
                    </b>
                  </div>
                </Html>
              )}

            </group>
          );
        }
      )}
    </group>
  );
}


/* ============================================================
   GLIDER
============================================================ */

function Glider() {
  const layers =
    useOceanStore(
      (state) =>
        state.layers
    );

  const vertical =
    useOceanStore(
      (state) =>
        state.vertical
    );

  const setStore =
    useOceanStore(
      (state) =>
        state.set
    );

  const groupRef =
    useRef<THREE.Group>(
      null
    );


  useFrame(
    ({ clock }) => {
      if (
        groupRef.current
      ) {
        groupRef.current.position.x =
          0.18 *
          Math.sin(
            clock.elapsedTime *
            0.55
          );
      }
    }
  );


  if (
    !layers.Gliders
  ) {
    return null;
  }


  const points: [
    number,
    number,
    number
  ][] = [
    [-2.2, 2.3, 2.4],
    [-1.5, 1.7, 1.8],
    [-0.7, 1.0, 1.0],
    [0.1, 0.25, 0.25],
    [0.9, -0.45, -0.45],
    [1.7, -1.1, -1.1],
    [2.5, -1.7, -1.7],
  ];


  return (
    <group
      ref={groupRef}
      scale={[
        1,
        vertical,
        1,
      ]}
      onClick={(
        event
      ) => {
        event.stopPropagation();

        setStore(
          'instrument',
          'Glider'
        );

        setStore(
          'instrumentId',
          'SG678'
        );
      }}
    >
      <Line
        points={points}
        color="#ef5cf5"
        lineWidth={2}
      />


      {points.map(
        (
          point,
          index
        ) => (
          <mesh
            key={index}
            position={point}
          >
            <sphereGeometry
              args={[
                0.055,
                12,
                12,
              ]}
            />

            <meshBasicMaterial
              color="#ff87f4"
            />
          </mesh>
        )
      )}


      <Html
        position={points[1]}
        distanceFactor={8}
      >
        <div className="scene-label mag">
          <span>
            Glider
          </span>

          <b>
            SG678
          </b>
        </div>
      </Html>

    </group>
  );
}


/* ============================================================
   CURRENTS
============================================================ */

function Currents() {
  const enabled =
    useOceanStore(
      (state) =>
        state.layers.Currents
    );

  const groupRef =
    useRef<THREE.Group>(
      null
    );


  useFrame(
    ({ clock }) => {
      if (
        groupRef.current
      ) {
        groupRef.current.position.x =
          0.12 *
          Math.sin(
            clock.elapsedTime *
            0.4
          );
      }
    }
  );


  if (!enabled) {
    return null;
  }


  return (
    <group ref={groupRef}>

      {Array.from(
        {
          length: 28,
        },
        (_, index) => {

          const x =
            -4.5 +
            (index % 7) *
            1.5;

          const z =
            -2.7 +
            Math.floor(
              index / 7
            ) *
            1.75;

          const angle =
            index * 0.73;

          const end: [
            number,
            number,
            number
          ] = [
            x +
              0.52 *
              Math.cos(angle),

            2.7,

            z +
              0.52 *
              Math.sin(angle),
          ];


          return (
            <group key={index}>

              <Line
                points={[
                  [
                    x,
                    2.7,
                    z,
                  ],
                  end,
                ]}
                color="#75dcff"
                transparent
                opacity={0.8}
              />


              <mesh
                position={end}
                rotation={[
                  0,
                  angle -
                  Math.PI / 2,
                  0,
                ]}
              >
                <coneGeometry
                  args={[
                    0.07,
                    0.18,
                    7,
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


/* ============================================================
   DEPTH SLICE
============================================================ */

function DepthSlice() {
  const s =
    useOceanStore();


  const geometry =
    useMemo(() => {
      const field =
        s.modelField;


      if (
        s.mode !==
        'Depth Slice'
      ) {
        return null;
      }


      if (
        !field?.shape ||
        !Array.isArray(
          field.values
        )
      ) {
        return null;
      }


      const nx =
        Number(
          field.shape.nx
        );

      const ny =
        Number(
          field.shape.ny
        );

      const nz =
        Number(
          field.shape.nz
        );


      if (
        !nx ||
        !ny ||
        !nz
      ) {
        return null;
      }


      let zIndex = 0;


      if (
        Array.isArray(
          field.depth
        ) &&
        field.depth.length > 0
      ) {
        let closest =
          Infinity;

        field.depth.forEach(
          (
            depth: number,
            index: number
          ) => {
            const distance =
              Math.abs(
                Number(depth) -
                s.depth
              );

            if (
              distance <
              closest
            ) {
              closest =
                distance;

              zIndex =
                index;
            }
          }
        );

      } else {
        zIndex =
          Math.round(
            clamp(
              s.depth /
              2000,
              0,
              1
            ) *
            (nz - 1)
          );
      }


      zIndex =
        clamp(
          zIndex,
          0,
          nz - 1
        );


      const positions: number[] =
        [];

      const colors: number[] =
        [];


      const lo =
        Number(
          s.colorMin
        );

      const hi =
        Math.max(
          lo + 1e-8,
          Number(
            s.colorMax
          )
        );


      const total =
        nx * ny;


      const step =
        total >
        MAX_SLICE_POINTS
          ? Math.ceil(
              Math.sqrt(
                total /
                MAX_SLICE_POINTS
              )
            )
          : 1;


      const yPosition =
        H / 2 -
        (
          zIndex /
          Math.max(
            1,
            nz - 1
          )
        ) *
        H;


      for (
        let y = 0;
        y < ny;
        y += step
      ) {
        for (
          let x = 0;
          x < nx;
          x += step
        ) {
          const index =
            zIndex *
              ny *
              nx +
            y *
              nx +
            x;


          const value =
            Number(
              field.values[
                index
              ]
            );


          if (
            !Number.isFinite(
              value
            )
          ) {
            continue;
          }


          let t =
            (
              value -
              lo
            ) /
            (
              hi -
              lo
            );


          t =
            clamp(
              t,
              0,
              1
            );


          if (s.log) {
            t =
              Math.log1p(
                9 * t
              ) /
              Math.log(10);
          }


          const color =
            palette(
              t,
              s.colorScale
            );


          const px =
            (
              x /
                Math.max(
                  1,
                  nx - 1
                ) -
              0.5
            ) *
            W;


          const pz =
            (
              y /
                Math.max(
                  1,
                  ny - 1
                ) -
              0.5
            ) *
            D;


          positions.push(
            px,
            yPosition,
            pz
          );


          colors.push(
            color.r,
            color.g,
            color.b
          );
        }
      }


      if (
        positions.length === 0
      ) {
        return null;
      }


      const result =
        new THREE.BufferGeometry();


      result.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
          positions,
          3
        )
      );


      result.setAttribute(
        'color',
        new THREE.Float32BufferAttribute(
          colors,
          3
        )
      );


      result.computeBoundingSphere();


      return result;

    }, [
      s.modelField,
      s.mode,
      s.depth,
      s.colorMin,
      s.colorMax,
      s.colorScale,
      s.log,
    ]);


  useEffect(() => {
    return () => {
      geometry?.dispose();
    };
  }, [geometry]);


  if (
    !geometry ||
    s.mode !==
      'Depth Slice'
  ) {
    return null;
  }


  const y =
    geometry.attributes
      .position
      .getY(0);


  return (
    <group
      scale={[
        1,
        s.vertical,
        1,
      ]}
    >
      <points
        geometry={geometry}
      >
        <pointsMaterial
          vertexColors
          size={0.13}
          sizeAttenuation
          transparent
          opacity={
            Math.min(
              0.95,
              s.opacity
            )
          }
          depthWrite={false}
        />
      </points>


      <Line
        points={[
          [
            -W / 2,
            y,
            -D / 2,
          ],

          [
            W / 2,
            y,
            -D / 2,
          ],

          [
            W / 2,
            y,
            D / 2,
          ],

          [
            -W / 2,
            y,
            D / 2,
          ],

          [
            -W / 2,
            y,
            -D / 2,
          ],
        ]}
        color="#79eaff"
        transparent
        opacity={0.8}
      />


      <Html
        position={[
          3.3,
          y + 0.2,
          1.8,
        ]}
        distanceFactor={8}
      >
        <div className="scene-label">
          <span>
            DEPTH SLICE
          </span>

          <b>
            {s.depth} m
          </b>
        </div>
      </Html>

    </group>
  );
}


/* ============================================================
   BATHYMETRY
============================================================ */

function Bathymetry() {
  const enabled =
    useOceanStore(
      (state) =>
        state.layers.Bathymetry
    );

  const vertical =
    useOceanStore(
      (state) =>
        state.vertical
    );


  const geometry =
    useMemo(() => {
      const geo =
        new THREE.PlaneGeometry(
          W - 0.12,
          D - 0.12,
          64,
          46
        );


      const position =
        geo.attributes
          .position as THREE.BufferAttribute;


      for (
        let i = 0;
        i < position.count;
        i++
      ) {
        const x =
          position.getX(i);

        const z =
          position.getY(i);


        const elevation =
          0.42 *
            Math.exp(
              -(
                (
                  (x + 1.2) ** 2
                ) +
                (
                  (z - 0.1) ** 2
                )
              ) /
              3
            ) +
          0.22 *
            Math.sin(
              x * 1.3
            ) *
            Math.cos(
              z * 1.8
            ) +
          0.08 *
            Math.sin(
              z * 4
            );


        position.setZ(
          i,
          elevation
        );
      }


      position.needsUpdate =
        true;

      geo.computeVertexNormals();


      return geo;

    }, []);


  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);


  if (!enabled) {
    return null;
  }


  return (
    <mesh
      geometry={geometry}
      position={[
        0,
        -(
          H / 2
        ) *
          vertical +
          0.08,
        0,
      ]}
      rotation={[
        -Math.PI / 2,
        0,
        0,
      ]}
    >
      <meshStandardMaterial
        color="#0b5f63"
        emissive="#04383a"
        emissiveIntensity={0.45}
        roughness={0.82}
        transparent
        opacity={0.95}
        side={
          THREE.DoubleSide
        }
      />
    </mesh>
  );
}


/* ============================================================
   CHLOROPHYLL LAYER
============================================================ */

function ChlorophyllLayer() {
  const enabled =
    useOceanStore(
      (state) =>
        state.layers.Chlorophyll
    );

  const vertical =
    useOceanStore(
      (state) =>
        state.vertical
    );


  const ref =
    useRef<THREE.Group>(
      null
    );


  /*
    IMPORTANT:
    All hooks are above the
    conditional return.
  */

  const geometry =
    useMemo(() => {
      const positions: number[] =
        [];

      const colors: number[] =
        [];

      const color =
        new THREE.Color(
          '#39ff88'
        );


      /*
        Deterministic distribution.
        No random regeneration.
      */

      for (
        let i = 0;
        i < 2200;
        i++
      ) {
        const a =
          i * 0.61803398875;

        const b =
          i * 0.38196601125;

        const x =
          -W / 2 +
          (a % 1) * W;

        const z =
          -D / 2 +
          (b % 1) * D;


        /*
          Concentrated near surface
        */

        const y =
          H / 2 -
          (
            (
              (i * 0.137) %
              1
            ) *
            1.45
          );


        positions.push(
          x,
          y,
          z
        );


        colors.push(
          color.r,
          color.g,
          color.b
        );
      }


      const geo =
        new THREE.BufferGeometry();


      geo.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
          positions,
          3
        )
      );


      geo.setAttribute(
        'color',
        new THREE.Float32BufferAttribute(
          colors,
          3
        )
      );


      return geo;

    }, []);


  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);


  useFrame(({ clock }) => {
    if (
      ref.current
    ) {
      ref.current.rotation.y =
        Math.sin(
          clock.elapsedTime *
          0.18
        ) *
        0.04;
    }
  });


  if (!enabled) {
    return null;
  }


  return (
    <group
      ref={ref}
      scale={[
        1,
        vertical,
        1,
      ]}
    >

      <points geometry={geometry}>
        <pointsMaterial
          vertexColors
          size={0.075}
          sizeAttenuation
          transparent
          opacity={0.9}
          depthWrite={false}
        />
      </points>


      {/* Visible chlorophyll glow */}

      <mesh
        position={[
          0,
          H / 2 - 0.72,
          0,
        ]}
        rotation={[
          -Math.PI / 2,
          0,
          0,
        ]}
      >
        <planeGeometry
          args={[
            W * 0.96,
            D * 0.96,
          ]}
        />

        <meshBasicMaterial
          color="#16d66f"
          transparent
          opacity={0.08}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>


      <Html
        position={[
          -4.3,
          H / 2 + 0.25,
          0,
        ]}
        distanceFactor={8}
      >
        <div className="scene-label">
          <span>
            Chlorophyll
          </span>

          <b>
            Surface Concentration
          </b>
        </div>
      </Html>

    </group>
  );
}


/* ============================================================
   SEA SURFACE HEIGHT
============================================================ */

function SeaSurfaceHeightLayer() {
  const enabled =
    useOceanStore(
      (state) =>
        state.layers[
          'Sea Surface Height'
        ]
    );


  const meshRef =
    useRef<THREE.Mesh>(
      null
    );


  const geometry =
    useMemo(() => {
      return new THREE.PlaneGeometry(
        W,
        D,
        72,
        56
      );
    }, []);


  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);


  useFrame(({ clock }) => {
    if (!enabled) {
      return;
    }


    const position =
      geometry.attributes
        .position as THREE.BufferAttribute;

    const time =
      clock.elapsedTime;


    for (
      let i = 0;
      i < position.count;
      i++
    ) {
      const x =
        position.getX(i);

      const z =
        position.getY(i);


      /*
        Stronger visible SSH anomaly
      */

      const wave =
        Math.sin(
          x * 1.15 +
          time * 0.8
        ) *
        0.24 +

        Math.cos(
          z * 1.45 -
          time * 0.6
        ) *
        0.16 +

        Math.sin(
          (x + z) * 0.7 +
          time * 0.4
        ) *
        0.08;


      position.setZ(
        i,
        wave
      );
    }


    position.needsUpdate =
      true;


    geometry.computeVertexNormals();
  });


  if (!enabled) {
    return null;
  }


  return (
    <group>

      <mesh
        ref={meshRef}
        geometry={geometry}
        position={[
          0,
          H / 2 + 0.16,
          0,
        ]}
        rotation={[
          -Math.PI / 2,
          0,
          0,
        ]}
      >
        <meshStandardMaterial
          color="#3978ff"
          emissive="#174ac0"
          emissiveIntensity={1.35}
          transparent
          opacity={0.58}
          roughness={0.2}
          metalness={0.5}
          side={THREE.DoubleSide}
        />
      </mesh>


      {/* SSH label */}

      <Html
        position={[
          3.5,
          H / 2 + 0.5,
          -2.2,
        ]}
        distanceFactor={8}
      >
        <div className="scene-label">
          <span>
            Sea Surface Height
          </span>

          <b>
            Dynamic SSH
          </b>
        </div>
      </Html>

    </group>
  );
}


/* ============================================================
   MEASUREMENT LAYER
============================================================ */

function MeasureLayer() {
  const points =
    useOceanStore(
      (state) =>
        state.measurePoints
    );


  if (
    points.length < 2
  ) {
    return null;
  }


  return (
    <>
      <Line
        points={[
          points[0],
          points[1],
        ]}
        color="#facc15"
        lineWidth={2}
      />


      {points.map(
        (
          point,
          index
        ) => (
          <mesh
            key={index}
            position={point}
          >
            <sphereGeometry
              args={[
                0.1,
                12,
                12,
              ]}
            />

            <meshBasicMaterial
              color="#facc15"
            />
          </mesh>
        )
      )}
    </>
  );
}


/* ============================================================
   MEASUREMENT CLICK PLANE
============================================================ */

function ClickPlane() {
  const measureMode =
    useOceanStore(
      (state) =>
        state.measureMode
    );

  const measurePoints =
    useOceanStore(
      (state) =>
        state.measurePoints
    );

  const setStore =
    useOceanStore(
      (state) =>
        state.set
    );


  if (!measureMode) {
    return null;
  }


  return (
    <mesh
      rotation={[
        -Math.PI / 2,
        0,
        0,
      ]}
      position={[
        0,
        0,
        0,
      ]}
      onClick={(
        event
      ) => {
        event.stopPropagation();


        const point: [
          number,
          number,
          number
        ] = [
          event.point.x,
          event.point.y,
          event.point.z,
        ];


        if (
          measurePoints.length >=
          2
        ) {
          setStore(
            'measurePoints',
            [point]
          );
        } else {
          setStore(
            'measurePoints',
            [
              ...measurePoints,
              point,
            ]
          );
        }
      }}
    >
      <planeGeometry
        args={[
          28,
          28,
        ]}
      />

      <meshBasicMaterial
        transparent
        opacity={0}
        depthWrite={false}
      />
    </mesh>
  );
}


/* ============================================================
   MAIN SCENE
============================================================ */

function SceneCanvas() {
  return (
    <Canvas
      camera={{
        position: [
          10.7,
          8.5,
          11.5,
        ],

        fov: 39,

        near: 0.1,

        far: 100,
      }}
      dpr={[
        1,
        1.5,
      ]}
      gl={{
        preserveDrawingBuffer:
          false,

        antialias:
          true,

        powerPreference:
          'high-performance',
      }}
    >

      {/* Background */}

      <color
        attach="background"
        args={[
          '#020812',
        ]}
      />


      <fog
        attach="fog"
        args={[
          '#020812',
          14,
          32,
        ]}
      />


      {/* Lights */}

      <ambientLight
        intensity={0.65}
      />


      <directionalLight
        position={[
          5,
          9,
          6,
        ]}
        intensity={1.35}
      />


      <pointLight
        position={[
          -4,
          3,
          3,
        ]}
        intensity={0.75}
        color="#075b99"
      />


      {/* Load uploaded scientific dataset */}

      <RealFieldLoader />


      {/* =====================================================
          MAIN OCEAN
      ===================================================== */}

      <OceanVolume />


      {/* =====================================================
          OPTIONAL SCIENTIFIC LAYERS
      ===================================================== */}

      <Bathymetry />

      <ChlorophyllLayer />

      <SeaSurfaceHeightLayer />

      <Argo />

      <Glider />

      <Currents />

      <DepthSlice />


      {/* =====================================================
          MEASUREMENT
      ===================================================== */}

      <MeasureLayer />

      <ClickPlane />


      {/* =====================================================
          CAMERA
      ===================================================== */}

      <OrbitControls
        enableDamping
        dampingFactor={0.075}
        maxDistance={25}
        minDistance={6}
        maxPolarAngle={
          Math.PI * 0.9
        }
        rotateSpeed={0.65}
        zoomSpeed={0.8}
        panSpeed={0.7}
      />

    </Canvas>
  );
}


/* ============================================================
   MAIN EXPORT
============================================================ */

export default function OceanScene() {
  return (
    <div
      className="scene"
      style={{
        width: '100%',
        height: '100%',
        minHeight: '500px',
        position: 'relative',
        overflow: 'hidden',

        background:
          'radial-gradient(circle at 50% 30%, #08243a 0%, #020812 70%)',
      }}
    >

      <SceneErrorBoundary>
        <SceneCanvas />
      </SceneErrorBoundary>


      {/* =====================================================
          GEOGRAPHIC LABELS
      ===================================================== */}

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


      {/* =====================================================
          CROSS SECTION
      ===================================================== */}

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


      {/* =====================================================
          INTERACTION HINT
      ===================================================== */}

      <div className="scene-hint">
        Drag to rotate · Scroll to zoom · Right drag to pan
      </div>

    </div>
  );
}
