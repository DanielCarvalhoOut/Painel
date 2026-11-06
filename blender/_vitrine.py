# Vitrine: importa um .glb (ex.: gerado pelo TRELLIS.2 no Colab) e renderiza em estúdio, com base, fundo e luz.
#   blender -b --factory-startup --offline-mode -P _vitrine.py -- <modelo.glb> <pasta_saida> [amostras] [quadros_giro] [porcentagem]
# Sai <nome>.png (vista principal), <nome>.blend e, com quadros_giro > 0, giro/0001.png… (360°, para virar vídeo).
# Começa com "_" para não aparecer na lista de modelos da aba Blender (não é um modelo: precisa de um .glb).

import bpy, sys, os, math, time
from math import radians
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _estudio

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
if not args:
    raise SystemExit('uso: _vitrine.py -- <modelo.glb> <pasta_saida> [amostras] [quadros_giro] [porcentagem]')
GLB = os.path.abspath(args[0])
SAIDA = os.path.abspath(args[1] if len(args) > 1 else os.path.dirname(GLB))
AMOSTRAS = int(args[2]) if len(args) > 2 else 256
GIRO = int(args[3]) if len(args) > 3 else 0
PORCENTAGEM = int(args[4]) if len(args) > 4 else 100
NOME = os.path.splitext(os.path.basename(GLB))[0]
os.makedirs(SAIDA, exist_ok=True)
t0 = time.time()

bpy.ops.wm.read_factory_settings(use_empty=True)
cena = bpy.context.scene
col = cena.collection

bpy.ops.import_scene.gltf(filepath=GLB)
importados = [o for o in bpy.context.selected_objects]
malhas = [o for o in importados if o.type == 'MESH']
if not malhas:
    raise SystemExit(f'Nenhuma malha em {GLB}')

# Raiz que gira; o modelo fica em pé sobre a base, com 2 unidades de altura.
raiz = bpy.data.objects.new('modelo', None)
col.objects.link(raiz)
for o in importados:
    if o.parent is None:
        o.parent = raiz
bpy.context.view_layer.update()
pontos = [o.matrix_world @ Vector(c) for o in malhas for c in o.bound_box]
minimo = Vector((min(p.x for p in pontos), min(p.y for p in pontos), min(p.z for p in pontos)))
maximo = Vector((max(p.x for p in pontos), max(p.y for p in pontos), max(p.z for p in pontos)))
altura = max(maximo.z - minimo.z, 1e-6)
escala = 2.0 / altura
raiz.scale = (escala,) * 3
centro = (minimo + maximo) / 2
raiz.location = (-centro.x * escala, -centro.y * escala, -minimo.z * escala + 0.12)
largura = max(maximo.x - minimo.x, maximo.y - minimo.y) * escala
faces = sum(len(o.data.polygons) for o in malhas)
for o in malhas:
    for p in o.data.polygons:
        p.use_smooth = True


def material(nome, cor, metal=0.0, rug=0.5):
    m = bpy.data.materials.new(nome)
    try:
        m.use_nodes = True
    except Exception:
        pass
    b = m.node_tree.nodes.get('Principled BSDF')
    for k, v in (('Base Color', (*cor, 1)), ('Metallic', metal), ('Roughness', rug)):
        if k in b.inputs:
            b.inputs[k].default_value = v
    return m


# Base redonda escura com friso, do tamanho do modelo.
r = max(0.55, largura * 0.62)
bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=r, depth=0.1, location=(0, 0, 0.05))
base = bpy.context.active_object
base.name = 'base'
base.data.materials.append(material('base', (0.025, 0.027, 0.031), metal=0.5, rug=0.35))
chanfro = base.modifiers.new('chanfro', 'BEVEL')
chanfro.width, chanfro.segments = 0.01, 3
bpy.ops.mesh.primitive_torus_add(major_radius=r + 0.004, minor_radius=0.006, major_segments=128, location=(0, 0, 0.1))
friso = bpy.context.active_object
friso.data.materials.append(material('friso', (0.95, 0.42, 0.05), metal=1, rug=0.25))

# Fundo infinito (piso que curva em parede).
import bmesh
me = bpy.data.meshes.new('fundo')
bm = bmesh.new()
v = [bm.verts.new(c) for c in ((-10, -10, 0), (10, -10, 0), (10, 4, 0), (-10, 4, 0), (10, 4, 10), (-10, 4, 10))]
bm.faces.new((v[0], v[1], v[2], v[3]))
bm.faces.new((v[3], v[2], v[4], v[5]))
bm.to_mesh(me)
bm.free()
fundo = bpy.data.objects.new('fundo', me)
col.objects.link(fundo)
curva = fundo.modifiers.new('curva', 'BEVEL')
curva.width, curva.segments, curva.limit_method = 3.0, 24, 'ANGLE'
fundo.data.materials.append(material('fundo', (0.012, 0.013, 0.017), rug=0.85))
for p in fundo.data.polygons:
    p.use_smooth = True

alvo = bpy.data.objects.new('alvo', None)
col.objects.link(alvo)
alvo.location = (0, 0, 1.12)


def luz(nome, loc, energia, cor, tamanho):
    d = bpy.data.lights.new(nome, 'AREA')
    d.energy, d.color, d.size = energia, cor, tamanho
    ob = bpy.data.objects.new(nome, d)
    col.objects.link(ob)
    ob.location = loc
    c = ob.constraints.new('TRACK_TO')
    c.target = alvo
    c.track_axis, c.up_axis = 'TRACK_NEGATIVE_Z', 'UP_Y'


luz('principal', (2.8, -3.4, 3.8), 1000, (1.0, 0.96, 0.9), 2.6)
luz('recorte frio', (-2.8, 2.4, 2.8), 750, (0.4, 0.7, 1.0), 1.8)
luz('recorte quente', (2.8, 2.6, 2.2), 550, (1.0, 0.62, 0.3), 1.6)
luz('preenchimento', (-3.6, -3.2, 1.2), 180, (0.9, 0.93, 1.0), 3.0)

mundo = bpy.data.worlds.new('mundo')
cena.world = mundo
try:
    mundo.use_nodes = True
except Exception:
    pass
bg = mundo.node_tree.nodes.get('Background')
if bg:
    bg.inputs['Color'].default_value = (0.006, 0.007, 0.01, 1)

cam = bpy.data.cameras.new('camera')
cam.lens = 60
cam.dof.use_dof = True
cam.dof.focus_object = alvo
cam.dof.aperture_fstop = 8
camera = bpy.data.objects.new('camera', cam)
col.objects.link(camera)
distancia = 4.9 * max(1.0, largura / 1.6)
camera.location = (distancia * 0.26, -distancia, 1.45)
rastreio = camera.constraints.new('TRACK_TO')
rastreio.target = alvo
rastreio.track_axis, rastreio.up_axis = 'TRACK_NEGATIVE_Z', 'UP_Y'
cena.camera = camera

_estudio.configurar_render(cena, PORCENTAGEM, AMOSTRAS)
cena.cycles.max_bounces = 8
print(f'[3d] vitrine montada em {time.time() - t0:.1f}s · {faces} faces', flush=True)

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(SAIDA, f'{NOME}.blend'))
raiz.rotation_euler = (0, 0, radians(-20))
cena.render.filepath = os.path.join(SAIDA, f'{NOME}.png')
t1 = time.time()
bpy.ops.render.render(write_still=True)
print(f'[3d] vista principal em {time.time() - t1:.1f}s', flush=True)

if GIRO > 0:
    # 360° em GIRO quadros, com menos amostras (o denoiser segura) para caber no tempo.
    cena.cycles.samples = max(32, AMOSTRAS // 4)
    os.makedirs(os.path.join(SAIDA, 'giro'), exist_ok=True)
    for q in range(GIRO):
        raiz.rotation_euler = (0, 0, radians(-20 + 360 * q / GIRO))
        cena.render.filepath = os.path.join(SAIDA, 'giro', f'{q + 1:04d}.png')
        bpy.ops.render.render(write_still=True)
        print(f'[3d] giro {q + 1}/{GIRO}', flush=True)

print(f'[3d] pronto em {time.time() - t0:.1f}s · {SAIDA}', flush=True)
