import type { MapData, TileData, TemplateType, Cell } from './types';
import { TerrainType, LayerType } from './types';
import { cellKey, setTile, getTile } from './utils';

export function createEmptyMap(width: number, height: number): MapData {
  return {
    width,
    height,
    tiles: {},
    layers: {
      [LayerType.Terrain]: { visible: true, locked: false, opacity: 1.0 },
      [LayerType.Obstacle]: { visible: true, locked: false, opacity: 1.0 },
      [LayerType.Decoration]: { visible: true, locked: false, opacity: 0.7 },
      [LayerType.Event]: { visible: true, locked: false, opacity: 0.8 },
    },
  };
}

class PerlinNoise {
  private permutation: number[];

  constructor(seed: number = Math.random() * 10000) {
    this.permutation = this.generatePermutation(seed);
  }

  private generatePermutation(seed: number): number[] {
    const p: number[] = [];
    for (let i = 0; i < 256; i++) {
      p[i] = i;
    }

    let n: number;
    let q: number;
    for (let i = 255; i > 0; i--) {
      seed = (seed * 16807) % 2147483647;
      n = seed % (i + 1);
      q = p[i];
      p[i] = p[n];
      p[n] = q;
    }

    return [...p, ...p];
  }

  private fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  private lerp(a: number, b: number, t: number): number {
    return a + t * (b - a);
  }

  private grad(hash: number, x: number, y: number): number {
    const h = hash & 3;
    const u = h < 2 ? x : y;
    const v = h < 2 ? y : x;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }

  noise(x: number, y: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;

    x -= Math.floor(x);
    y -= Math.floor(y);

    const u = this.fade(x);
    const v = this.fade(y);

    const A = this.permutation[X] + Y;
    const B = this.permutation[X + 1] + Y;

    return this.lerp(
      this.lerp(this.grad(this.permutation[A], x, y), this.grad(this.permutation[B], x - 1, y), u),
      this.lerp(this.grad(this.permutation[A + 1], x, y - 1), this.grad(this.permutation[B + 1], x - 1, y - 1), u),
      v
    );
  }

  octaveNoise(x: number, y: number, octaves: number, persistence: number): number {
    let total = 0;
    let frequency = 1;
    let amplitude = 1;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
      total += this.noise(x * frequency, y * frequency) * amplitude;
      maxValue += amplitude;
      amplitude *= persistence;
      frequency *= 2;
    }

    return total / maxValue;
  }
}

export function generateMaze(width: number, height: number): MapData {
  const map = createEmptyMap(width, height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tile = getTile(map, x, y);
      tile.terrain = TerrainType.Wall;
      setTile(map, x, y, tile);
    }
  }

  function carve(x: number, y: number, visited: boolean[][]) {
    visited[y][x] = true;
    const tile = getTile(map, x, y);
    tile.terrain = TerrainType.Walkable;
    setTile(map, x, y, tile);

    const directions = [
      { dx: 0, dy: -2 },
      { dx: 2, dy: 0 },
      { dx: 0, dy: 2 },
      { dx: -2, dy: 0 },
    ].sort(() => Math.random() - 0.5);

    for (const dir of directions) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;

      if (
        nx > 0 && nx < width - 1 &&
        ny > 0 && ny < height - 1 &&
        !visited[ny][nx]
      ) {
        const mx = x + dir.dx / 2;
        const my = y + dir.dy / 2;
        const wallTile = getTile(map, mx, my);
        wallTile.terrain = TerrainType.Walkable;
        setTile(map, mx, my, wallTile);

        carve(nx, ny, visited);
      }
    }
  }

  const visited = Array(height).fill(null).map(() => Array(width).fill(false));
  carve(1, 1, visited);

  return map;
}

export function generateOpenTerrain(width: number, height: number): MapData {
  const map = createEmptyMap(width, height);

  const obstacleCount = Math.floor(width * height * 0.15);

  for (let i = 0; i < obstacleCount; i++) {
    const x = Math.floor(Math.random() * width);
    const y = Math.floor(Math.random() * height);

    const obstacleType = Math.random();
    const tile = getTile(map, x, y);

    if (obstacleType < 0.3) {
      let clusterSize = Math.floor(Math.random() * 5) + 2;
      for (let dy = -clusterSize; dy <= clusterSize; dy++) {
        for (let dx = -clusterSize; dx <= clusterSize; dx++) {
          if (dx * dx + dy * dy <= clusterSize * clusterSize) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const t = getTile(map, nx, ny);
              t.obstacle = true;
              setTile(map, nx, ny, t);
            }
          }
        }
      }
    } else if (obstacleType < 0.5) {
      tile.terrain = TerrainType.Wall;
      let clusterSize = Math.floor(Math.random() * 3) + 1;
      for (let dy = -clusterSize; dy <= clusterSize; dy++) {
        for (let dx = -clusterSize; dx <= clusterSize; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const t = getTile(map, nx, ny);
            t.terrain = TerrainType.Wall;
            setTile(map, nx, ny, t);
          }
        }
      }
    } else if (obstacleType < 0.7) {
      tile.terrain = TerrainType.Water;
      let clusterSize = Math.floor(Math.random() * 4) + 2;
      for (let dy = -clusterSize; dy <= clusterSize; dy++) {
        for (let dx = -clusterSize; dx <= clusterSize; dx++) {
          if (dx * dx + dy * dy <= clusterSize * clusterSize * 0.7) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const t = getTile(map, nx, ny);
              t.terrain = TerrainType.Water;
              setTile(map, nx, ny, t);
            }
          }
        }
      }
    } else if (obstacleType < 0.85) {
      tile.terrain = TerrainType.Sand;
    } else {
      tile.terrain = TerrainType.Grass;
    }
    setTile(map, x, y, tile);
  }

  return map;
}

export function generateCityStreets(width: number, height: number): MapData {
  const map = createEmptyMap(width, height);
  const blockSize = 8;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const isHorizontalRoad = y % blockSize === 0 || y % blockSize === blockSize - 1;
      const isVerticalRoad = x % blockSize === 0 || x % blockSize === blockSize - 1;

      const tile = getTile(map, x, y);
      if (isHorizontalRoad || isVerticalRoad) {
        tile.terrain = TerrainType.Walkable;
      } else {
        const buildingChance = Math.random();
        if (buildingChance < 0.6) {
          tile.terrain = TerrainType.Wall;
        } else if (buildingChance < 0.75) {
          tile.terrain = TerrainType.Grass;
        } else if (buildingChance < 0.85) {
          tile.terrain = TerrainType.Sand;
        } else {
          tile.terrain = TerrainType.Water;
        }
      }
      setTile(map, x, y, tile);
    }
  }

  return map;
}

export function generateNaturalTerrain(width: number, height: number): MapData {
  const map = createEmptyMap(width, height);
  const noise = new PerlinNoise(Math.random() * 10000);
  const moistureNoise = new PerlinNoise(Math.random() * 10000 + 1000);

  const scale = 0.05;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const elevation = noise.octaveNoise(x * scale, y * scale, 4, 0.5);
      const moisture = moistureNoise.octaveNoise(x * scale * 1.5, y * scale * 1.5, 3, 0.5);

      const tile = getTile(map, x, y);

      if (elevation < -0.3) {
        tile.terrain = TerrainType.Water;
      } else if (elevation < -0.1) {
        tile.terrain = TerrainType.Sand;
      } else if (elevation < 0.3) {
        if (moisture > 0.2) {
          tile.terrain = TerrainType.Grass;
        } else if (moisture > 0) {
          tile.terrain = TerrainType.Sand;
        } else {
          tile.terrain = TerrainType.Walkable;
        }
      } else if (elevation < 0.5) {
        if (moisture > 0.3) {
          tile.terrain = TerrainType.Swamp;
        } else {
          tile.terrain = TerrainType.Grass;
        }
      } else {
        tile.terrain = TerrainType.Wall;
      }

      setTile(map, x, y, tile);
    }
  }

  return map;
}

export function generateMap(template: TemplateType, width: number, height: number): MapData {
  switch (template) {
    case 'blank':
      return createEmptyMap(width, height);
    case 'maze':
      return generateMaze(width, height);
    case 'open':
      return generateOpenTerrain(width, height);
    case 'city':
      return generateCityStreets(width, height);
    case 'natural':
      return generateNaturalTerrain(width, height);
    default:
      return createEmptyMap(width, height);
  }
}

export function resizeMap(map: MapData, newWidth: number, newHeight: number): { map: MapData; cropped: boolean } {
  const newMap = createEmptyMap(newWidth, newHeight);
  let cropped = false;

  for (const [key, tile] of Object.entries(map.tiles)) {
    const [x, y] = key.split(',').map(Number);
    if (x < newWidth && y < newHeight) {
      newMap.tiles[key] = { ...tile };
    } else {
      cropped = true;
    }
  }

  for (const [layer, info] of Object.entries(map.layers)) {
    newMap.layers[Number(layer) as LayerType] = { ...info };
  }

  return { map: newMap, cropped };
}

export function exportMapToJSON(map: MapData): string {
  return JSON.stringify(map, null, 2);
}

export function importMapFromJSON(json: string): MapData {
  const data = JSON.parse(json);
  return {
    width: data.width || 64,
    height: data.height || 64,
    tiles: data.tiles || {},
    layers: {
      [LayerType.Terrain]: data.layers?.[LayerType.Terrain] || { visible: true, locked: false, opacity: 1.0 },
      [LayerType.Obstacle]: data.layers?.[LayerType.Obstacle] || { visible: true, locked: false, opacity: 1.0 },
      [LayerType.Decoration]: data.layers?.[LayerType.Decoration] || { visible: true, locked: false, opacity: 0.7 },
      [LayerType.Event]: data.layers?.[LayerType.Event] || { visible: true, locked: false, opacity: 0.8 },
    },
  };
}

export function exportMapToPNG(map: MapData): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = map.width;
    canvas.height = map.height;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      reject(new Error('Failed to get canvas context'));
      return;
    }

    const colors: Record<number, string> = {
      0: '#ffffff',
      1: '#1a1a2e',
      2: '#3498db',
      3: '#f1c40f',
      4: '#2ecc71',
      5: '#1e8449',
    };

    const imageData = ctx.createImageData(map.width, map.height);

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const tile = map.tiles[cellKey(x, y)] || { terrain: 0, obstacle: false };
        let color = colors[tile.terrain] || '#ffffff';

        if (tile.obstacle) {
          color = '#8B4513';
        }

        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);

        const idx = (y * map.width + x) * 4;
        imageData.data[idx] = r;
        imageData.data[idx + 1] = g;
        imageData.data[idx + 2] = b;
        imageData.data[idx + 3] = 255;
      }
    }

    ctx.putImageData(imageData, 0, 0);
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to create blob'));
    }, 'image/png');
  });
}

export function exportToTMX(map: MapData): string {
  const tileTypes = ['walkable', 'wall', 'water', 'sand', 'grass', 'swamp'];

  let tmx = `<?xml version="1.0" encoding="UTF-8"?>
<map version="1.10" tiledversion="1.10.1" orientation="orthogonal" renderorder="right-down" width="${map.width}" height="${map.height}" tilewidth="32" tileheight="32" infinite="0" nextlayerid="5" nextobjectid="1">
 <tileset firstgid="1" name="terrain" tilewidth="32" tileheight="32" tilecount="6" columns="6">
  <image source="terrain.png" width="192" height="32"/>
 </tileset>
 <layer id="1" name="Terrain" width="${map.width}" height="${map.height}">
  <data encoding="csv">`;

  const terrainData: string[] = [];
  for (let y = 0; y < map.height; y++) {
    const row: string[] = [];
    for (let x = 0; x < map.width; x++) {
      const tile = map.tiles[cellKey(x, y)] || { terrain: 0 };
      row.push(String(tile.terrain + 1));
    }
    terrainData.push(row.join(','));
  }
  tmx += terrainData.join(',\n');

  tmx += `  </data>
 </layer>
 <objectgroup id="2" name="Obstacles">`;

  for (const [key, tile] of Object.entries(map.tiles)) {
    if (tile.obstacle) {
      const [x, y] = key.split(',').map(Number);
      tmx += `
  <object id="${x * map.height + y}" x="${x * 32}" y="${y * 32}" width="32" height="32"/>`;
    }
  }

  tmx += `
 </objectgroup>
</map>`;

  return tmx;
}

export function importFromTMX(tmxContent: string): MapData {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(tmxContent, 'text/xml');

  const mapElement = xmlDoc.querySelector('map');
  if (!mapElement) throw new Error('Invalid TMX file');

  const width = parseInt(mapElement.getAttribute('width') || '64', 10);
  const height = parseInt(mapElement.getAttribute('height') || '64', 10);

  const map = createEmptyMap(width, height);

  const dataElement = mapElement.querySelector('layer data');
  if (dataElement && dataElement.textContent) {
    const csvData = dataElement.textContent.replace(/\s/g, '').split(',');
    for (let i = 0; i < csvData.length; i++) {
      const x = i % width;
      const y = Math.floor(i / width);
      const gid = parseInt(csvData[i], 10);
      const tile = getTile(map, x, y);
      tile.terrain = (gid - 1) as TerrainType;
      setTile(map, x, y, tile);
    }
  }

  const objects = mapElement.querySelectorAll('objectgroup object');
  objects.forEach((obj) => {
    const x = Math.floor(parseInt(obj.getAttribute('x') || '0', 10) / 32);
    const y = Math.floor(parseInt(obj.getAttribute('y') || '0', 10) / 32);
    if (x >= 0 && x < width && y >= 0 && y < height) {
      const tile = getTile(map, x, y);
      tile.obstacle = true;
      setTile(map, x, y, tile);
    }
  });

  return map;
}
