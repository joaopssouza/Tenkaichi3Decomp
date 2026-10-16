import math, struct, zlib, os

def make_png(width, height, rgb_pixels):
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter type 0 (None)
        raw.extend(rgb_pixels[y*width*3 : (y+1)*width*3])
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b'')

def render_dragon_ball(size):
    pixels = bytearray(size * size * 3)
    c = size / 2.0
    r = size * 0.42
    
    # 4 stars coordinates
    stars = [
        (c - size * 0.11, c - size * 0.11),
        (c + size * 0.11, c - size * 0.11),
        (c - size * 0.11, c + size * 0.11),
        (c + size * 0.11, c + size * 0.11)
    ]
    star_r = size * 0.075

    def make_star_poly(sx, sy, rad):
        pts = []
        for i in range(10):
            ang = -math.pi / 2 + i * math.pi / 5
            r_cur = rad if i % 2 == 0 else rad * 0.40
            pts.append((sx + r_cur * math.cos(ang), sy + r_cur * math.sin(ang)))
        return pts

    star_polys = [make_star_poly(sx, sy, star_r) for sx, sy in stars]

    def in_poly(px, py, poly):
        inside = False
        n = len(poly)
        p1x, p1y = poly[0]
        for i in range(n + 1):
            p2x, p2y = poly[i % n]
            if py > min(p1y, p2y):
                if py <= max(p1y, p2y):
                    if px <= max(p1x, p2x):
                        if p1y != p2y:
                            xinters = (py - p1y) * (p2x - p1x) / (p2y - p1y) + p1x
                        if p1x == p2x or px <= xinters:
                            inside = not inside
            p1x, p1y = p2x, p2y
        return inside

    for y in range(size):
        for x in range(size):
            dx = x - c
            dy = y - c
            dist = math.hypot(dx, dy)
            idx = (y * size + x) * 3
            if dist > r:
                # Dark background
                pixels[idx] = 11
                pixels[idx+1] = 12
                pixels[idx+2] = 16
            else:
                # Inside ball: Sphere normal and lighting
                nx = dx / r
                ny = dy / r
                nz = math.sqrt(max(0.0, 1.0 - nx*nx - ny*ny))
                
                # Light source from top-left-front (-0.5, -0.6, 0.8)
                lx, ly, lz = -0.45, -0.55, 0.70
                l_len = math.hypot(lx, ly, lz)
                lx /= l_len; ly /= l_len; lz /= l_len
                
                diff = max(0.0, nx*lx + ny*ly + nz*lz)
                # Specular highlight
                spec = math.pow(diff, 16)
                
                # Base ball colors: golden orange
                base_r = int(255 * (0.85 + 0.15 * diff) + 255 * spec * 0.4)
                base_g = int(140 * (0.70 + 0.30 * diff) + 255 * spec * 0.4)
                base_b = int(25 * (0.60 + 0.40 * diff) + 255 * spec * 0.4)
                
                base_r = min(255, max(0, base_r))
                base_g = min(255, max(0, base_g))
                base_b = min(255, max(0, base_b))
                
                # Check stars
                star_hit = False
                for poly in star_polys:
                    if in_poly(x, y, poly):
                        star_hit = True
                        break
                            
                if star_hit:
                    # Red star
                    pixels[idx] = 220
                    pixels[idx+1] = 30
                    pixels[idx+2] = 30
                else:
                    pixels[idx] = base_r
                    pixels[idx+1] = base_g
                    pixels[idx+2] = base_b

    return make_png(size, size, pixels)

def main():
    os.makedirs('port/web/icons', exist_ok=True)
    for s in (180, 192, 512):
        png = render_dragon_ball(s)
        out_path = f'port/web/icon-{s}.png'
        with open(out_path, 'wb') as f:
            f.write(png)
        print(f'Wrote {out_path} ({len(png)} bytes)')

if __name__ == '__main__':
    main()
