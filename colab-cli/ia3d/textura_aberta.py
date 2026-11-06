# Exportação .glb do TRELLIS.2 sem o nvdiffrast (NVIDIA, licença só para uso não comercial).
#
# O to_glb original (o_voxel.postprocess, MIT, Jianfeng Xiang / Microsoft) usa o nvdiffrast em um único passo:
# rasterizar os triângulos no espaço UV para saber qual ponto 3D cada pixel da textura representa. Aqui esse
# passo é feito em PyTorch puro na GPU (rasterizar_uv). O resto segue o original: limpeza e remesh com o CuMesh,
# UV, amostragem do volume de atributos com o FlexGEMM e material PBR (cor, metal, rugosidade).
#
# sem_nvidia() registra módulos vazios "nvdiffrast" e "nvdiffrec_render" antes de importar o TRELLIS.2: o
# código deles só é carregado pelos renderizadores de prévia, que o Painel não usa (a vitrine é no Blender).

import sys, types


def sem_nvidia():
    def faltando(nome):
        def __getattr__(attr):
            raise ImportError(f'{nome}.{attr}: o Painel não instala o {nome} (licença NVIDIA não comercial). '
                              'Use textura_aberta.to_glb_aberto em vez do to_glb original.')
        m = types.ModuleType(nome)
        m.__getattr__ = __getattr__
        return m
    for nome in ('nvdiffrast', 'nvdiffrast.torch', 'nvdiffrec_render', 'nvdiffrec_render.light'):
        sys.modules.setdefault(nome, faltando(nome))
    sys.modules['nvdiffrast'].torch = sys.modules['nvdiffrast.torch']


def rasterizar_uv(uvs, faces, tamanho, lote=100000):
    """Para cada texel (centro do pixel) da textura tamanho x tamanho, o triângulo que o cobre no espaço UV.

    uvs: (V, 2) em [0, 1]; faces: (F, 3). Devolve (face_id, bary): face_id (T, T) int64 com -1 onde não há
    triângulo e bary (T, T, 3) com as coordenadas baricêntricas. A linha r da imagem corresponde a v = (r + 0.5) / T,
    a mesma convenção do original (que depois inverte o V para o glTF).
    """
    import torch
    T = int(tamanho)
    dev = uvs.device
    face_id = torch.full((T * T,), -1, dtype=torch.int64, device=dev)
    P_todos = uvs.float() * T - 0.5  # coordenadas de pixel em que o centro do texel é inteiro
    for i in range(0, faces.shape[0], lote):
        f = faces[i:i + lote].long()
        P = P_todos[f]  # (n, 3, 2)
        minimo = torch.ceil(P.amin(dim=1)).clamp(0, T - 1).long()
        maximo = torch.floor(P.amax(dim=1)).clamp(0, T - 1).long()
        w = (maximo[:, 0] - minimo[:, 0] + 1).clamp(min=0)
        h = (maximo[:, 1] - minimo[:, 1] + 1).clamp(min=0)
        a = P[:, 0]
        e1 = P[:, 1] - a
        e2 = P[:, 2] - a
        det = e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0]
        n = torch.where(det.abs() > 1e-12, w * h, torch.zeros_like(w))
        total = int(n.sum())
        if total == 0:
            continue
        # Candidatos em blocos de até ~16 M texels para não estourar a memória.
        inicio = 0
        cum = torch.cumsum(n, 0)
        while inicio < f.shape[0]:
            base = int(cum[inicio - 1]) if inicio > 0 else 0
            fim = int(torch.searchsorted(cum, torch.tensor(base + (1 << 24), device=dev)).item())
            fim = max(fim, inicio + 1)
            fim = min(fim, f.shape[0])
            nb = n[inicio:fim]
            qtd = int(nb.sum())
            if qtd:
                idx = torch.repeat_interleave(torch.arange(inicio, fim, device=dev), nb)
                desloc = torch.arange(qtd, device=dev) - (torch.cumsum(nb, 0) - nb).repeat_interleave(nb)
                px = minimo[idx, 0] + desloc % w[idx]
                py = minimo[idx, 1] + torch.div(desloc, w[idx], rounding_mode='floor')
                q = torch.stack([px, py], -1).float() - a[idx]
                d = det[idx]
                b1 = (q[:, 0] * e2[idx, 1] - q[:, 1] * e2[idx, 0]) / d
                b2 = (e1[idx, 0] * q[:, 1] - e1[idx, 1] * q[:, 0]) / d
                eps = -1e-6
                dentro = (b1 >= eps) & (b2 >= eps) & (b1 + b2 <= 1 - eps)
                alvo = (py * T + px)[dentro]
                face_id[alvo] = idx[dentro] + i
            inicio = fim
    face_id = face_id.view(T, T)
    # Baricêntricas recalculadas a partir do triângulo escolhido (assim face e pesos sempre combinam).
    validos = face_id >= 0
    bary = torch.zeros((T, T, 3), device=dev)
    ys, xs = torch.nonzero(validos, as_tuple=True)
    f = faces[face_id[ys, xs]].long()
    P = P_todos[f]
    a, e1, e2 = P[:, 0], P[:, 1] - P[:, 0], P[:, 2] - P[:, 0]
    q = torch.stack([xs, ys], -1).float() - a
    d = e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0]
    b1 = (q[:, 0] * e2[:, 1] - q[:, 1] * e2[:, 0]) / d
    b2 = (e1[:, 0] * q[:, 1] - e1[:, 1] * q[:, 0]) / d
    bary[ys, xs] = torch.stack([1 - b1 - b2, b1, b2], -1)
    return face_id, bary


def to_glb_aberto(vertices, faces, attr_volume, coords, attr_layout, aabb, voxel_size,
                  decimation_target=1000000, texture_size=2048, remesh=True, remesh_band=1, remesh_project=0.0,
                  log=print):
    """Mesmo resultado do o_voxel.postprocess.to_glb (remesh ou simplificação, UV, textura PBR), sem nvdiffrast."""
    import numpy as np, torch, cv2, trimesh, trimesh.visual
    from PIL import Image
    import cumesh
    from flex_gemm.ops.grid_sample import grid_sample_3d

    aabb = torch.tensor(np.array(aabb), dtype=torch.float32, device=coords.device)
    if hasattr(voxel_size, 'tolist'):
        voxel_size = voxel_size.tolist()
    if isinstance(voxel_size, (int, float)):
        voxel_size = [voxel_size] * 3
    voxel_size = torch.tensor(np.array(voxel_size, dtype=np.float32), device=coords.device)
    grid_size = ((aabb[1] - aabb[0]) / voxel_size).round().int()

    log(f'[3d] malha original: {vertices.shape[0]} vértices, {faces.shape[0]} faces')
    vertices, faces = vertices.cuda(), faces.cuda()
    mesh = cumesh.CuMesh()
    mesh.init(vertices, faces)
    mesh.fill_holes(max_hole_perimeter=3e-2)
    vertices, faces = mesh.read()
    bvh = cumesh.cuBVH(vertices, faces)

    if remesh:
        center = aabb.mean(dim=0)
        scale = (aabb[1] - aabb[0]).max().item()
        resolution = grid_size.max().item()
        mesh.init(*cumesh.remeshing.remesh_narrow_band_dc(
            vertices, faces, center=center, scale=(resolution + 3 * remesh_band) / resolution * scale,
            resolution=resolution, band=remesh_band, project_back=remesh_project, verbose=False, bvh=bvh,
        ))
        mesh.simplify(decimation_target, verbose=False)
    else:
        mesh.simplify(decimation_target * 3, verbose=False)
        mesh.remove_duplicate_faces(); mesh.repair_non_manifold_edges()
        mesh.remove_small_connected_components(1e-5); mesh.fill_holes(max_hole_perimeter=3e-2)
        mesh.simplify(decimation_target, verbose=False)
        mesh.remove_duplicate_faces(); mesh.repair_non_manifold_edges()
        mesh.remove_small_connected_components(1e-5); mesh.fill_holes(max_hole_perimeter=3e-2)
        mesh.unify_face_orientations()
    log(f'[3d] malha final: {mesh.num_vertices} vértices, {mesh.num_faces} faces; abrindo UV')

    out_vertices, out_faces, out_uvs, out_vmaps = mesh.uv_unwrap(
        compute_charts_kwargs={'threshold_cone_half_angle_rad': np.radians(90.0), 'refine_iterations': 0,
                               'global_iterations': 1, 'smooth_strength': 1},
        return_vmaps=True, verbose=False,
    )
    out_vertices, out_faces, out_uvs, out_vmaps = out_vertices.cuda(), out_faces.cuda(), out_uvs.cuda(), out_vmaps.cuda()
    mesh.compute_vertex_normals()
    out_normals = mesh.read_vertex_normals()[out_vmaps]

    log(f'[3d] assando a textura {texture_size}x{texture_size}')
    face_id, bary = rasterizar_uv(out_uvs, out_faces, texture_size)
    mask = face_id >= 0
    fv = out_vertices[out_faces[face_id[mask]].long()]  # (N, 3, 3)
    valid_pos = (fv * bary[mask].unsqueeze(-1)).sum(dim=1)
    # Volta para a malha original de alta resolução (corrige o erro da simplificação), como no original.
    _, fid, uvw = bvh.unsigned_distance(valid_pos, return_uvw=True)
    orig = vertices[faces[fid.long()]]
    valid_pos = (orig * uvw.unsqueeze(-1)).sum(dim=1)
    attrs = torch.zeros(texture_size, texture_size, attr_volume.shape[1], device='cuda')
    attrs[mask] = grid_sample_3d(
        attr_volume, torch.cat([torch.zeros_like(coords[:, :1]), coords], dim=-1),
        shape=torch.Size([1, attr_volume.shape[1], *grid_size.tolist()]),
        grid=((valid_pos - aabb[0]) / voxel_size).reshape(1, -1, 3), mode='trilinear',
    )

    mask = mask.cpu().numpy()
    canal = lambda k: np.clip(attrs[..., attr_layout[k]].cpu().numpy() * 255, 0, 255).astype(np.uint8)
    base_color, metallic, roughness, alpha = canal('base_color'), canal('metallic'), canal('roughness'), canal('alpha')
    vazio = (~mask).astype(np.uint8)
    base_color = cv2.inpaint(base_color, vazio, 3, cv2.INPAINT_TELEA)
    metallic = cv2.inpaint(metallic, vazio, 1, cv2.INPAINT_TELEA)[..., None]
    roughness = cv2.inpaint(roughness, vazio, 1, cv2.INPAINT_TELEA)[..., None]
    alpha = cv2.inpaint(alpha, vazio, 1, cv2.INPAINT_TELEA)[..., None]
    material = trimesh.visual.material.PBRMaterial(
        baseColorTexture=Image.fromarray(np.concatenate([base_color, alpha], axis=-1)),
        baseColorFactor=np.array([255, 255, 255, 255], dtype=np.uint8),
        metallicRoughnessTexture=Image.fromarray(np.concatenate([np.zeros_like(metallic), roughness, metallic], axis=-1)),
        metallicFactor=1.0, roughnessFactor=1.0, alphaMode='OPAQUE', doubleSided=not remesh,
    )
    v = out_vertices.cpu().numpy(); n = out_normals.cpu().numpy(); uv = out_uvs.cpu().numpy()
    v[:, 1], v[:, 2] = v[:, 2], -v[:, 1].copy()
    n[:, 1], n[:, 2] = n[:, 2], -n[:, 1].copy()
    uv[:, 1] = 1 - uv[:, 1]
    return trimesh.Trimesh(vertices=v, faces=out_faces.cpu().numpy(), vertex_normals=n, process=False,
                           visual=trimesh.visual.TextureVisuals(uv=uv, material=material))
