# Funções comuns dos scripts 3D do estúdio (importado pelos scripts desta pasta; não é um modelo).
#   blender -b --factory-startup --offline-mode -P <script>.py -- <pasta_saida> [porcentagem] [amostras]
# Com EDITORVIDEOS_GPU=1 (o notebook 4_blender do Colab põe), o Cycles usa a GPU (OptiX, senão CUDA).

import bpy, os, sys


def argumentos(nome_padrao):
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    saida = os.path.abspath(args[0] if args else os.path.join(os.path.dirname(__file__), '..', 'saida', nome_padrao))
    porcentagem = int(args[1]) if len(args) > 1 else 100
    amostras = int(args[2]) if len(args) > 2 else 128
    os.makedirs(saida, exist_ok=True)
    return saida, porcentagem, amostras


def usar_gpu(cena):
    """Liga a GPU no Cycles, se houver. Devolve o tipo usado ('OPTIX', 'CUDA') ou None (fica no CPU)."""
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for tipo in ('OPTIX', 'CUDA'):
        try:
            prefs.compute_device_type = tipo
            (getattr(prefs, 'refresh_devices', None) or prefs.get_devices)()
            if not any(d.type == tipo for d in prefs.devices):
                continue
            for d in prefs.devices:
                d.use = d.type == tipo
            cena.cycles.device = 'GPU'
            return tipo
        except Exception:
            continue
    return None


def configurar_render(cena, porcentagem, amostras, largura=1080, altura=1350):
    cena.render.engine = 'CYCLES'
    cena.cycles.device = 'CPU'
    dispositivo = usar_gpu(cena) if os.environ.get('EDITORVIDEOS_GPU') == '1' else None
    cena.cycles.samples = amostras
    cena.cycles.use_adaptive_sampling = True
    cena.cycles.adaptive_threshold = 0.015 if dispositivo else 0.02
    cena.cycles.use_denoising = True
    cena.render.resolution_x, cena.render.resolution_y = largura, altura
    cena.render.resolution_percentage = porcentagem
    cena.render.image_settings.file_format = 'PNG'
    try:
        cena.view_settings.view_transform = 'AgX'
        cena.view_settings.look = 'AgX - Medium High Contrast'
    except Exception:
        pass
    print(f'[3d] render no {dispositivo or "CPU"}', flush=True)
    return dispositivo


def exportar_glb(caminho, remover=()):
    """Curvas e textos viram malha e o que é só cenário (fundo, pedestal) sai; depois exporta o .glb."""
    col = bpy.context.scene.collection
    dg = bpy.context.evaluated_depsgraph_get()
    for ob in list(bpy.context.scene.objects):
        if ob.type in {'CURVE', 'FONT'}:
            me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
            novo = bpy.data.objects.new(ob.name, me)
            novo.matrix_world = ob.matrix_world.copy()
            col.objects.link(novo)
            bpy.data.objects.remove(ob)
    for nome in remover:
        if nome in bpy.data.objects:
            bpy.data.objects.remove(bpy.data.objects[nome])
    opcoes = dict(filepath=caminho, export_format='GLB', export_apply=True)
    try:
        bpy.ops.export_scene.gltf(**opcoes, export_cameras=False, export_lights=False)
    except TypeError:
        bpy.ops.export_scene.gltf(**opcoes)
    dg = bpy.context.evaluated_depsgraph_get()
    return sum(len(o.evaluated_get(dg).data.polygons) for o in bpy.context.scene.objects if o.type == 'MESH')
