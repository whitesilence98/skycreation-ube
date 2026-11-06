"""Group pack assets into category/meshes and category/textures; never overwrite.

python -I scripts/organize_pack.py ROOT          # preview
python -I scripts/organize_pack.py ROOT --apply  # move + verify every byte
"""
import argparse
import hashlib
from pathlib import Path


def destination(rel: Path) -> Path:
    parts = rel.parts
    section = parts[0].lower()
    if section == 'skse':
        return Path('presets') / rel
    if section not in ('meshes', 'textures'):
        return rel
    sub = parts[1].lower() if len(parts) > 1 else ''
    category = 'shared'
    if section == 'meshes':
        if sub in ('hairs', 'clothes'):
            return Path('hair' if sub == 'hairs' else 'clothing', 'meshes', *parts[2:])
        if sub == 'actors':
            category = 'skeleton'
        elif sub == '!ube' and len(parts) > 2:
            category = {'head': 'head', 'eyes': 'eyes', 'brows': 'brows',
                        'lashes': 'lashes', 'mouth': 'mouth', 'armor': 'clothing'}.get(parts[2].lower(), 'body')
    else:
        if sub == '!ube' and len(parts) > 2:
            category = {'head': 'head', 'head ao': 'head', 'body': 'body',
                        'nails': 'body'}.get(parts[2].lower(), 'overlays')
        elif sub in ('armor', 'xiaoyu hair'):
            category = 'hair'
        elif sub == 'caenarvon' and len(parts) > 2 and parts[2].lower() == 'cosplay':
            category = 'clothing'
        elif sub == 'actors':
            category = 'body'
    return Path(category) / rel


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    root = args.root.resolve(strict=True)
    assert root.is_dir()
    moves = []
    targets = set()
    for folder in ('meshes', 'textures', 'SKSE'):
        source = root / folder
        if not source.exists():
            continue
        for p in sorted(source.rglob('*')):
            assert not p.is_symlink() and not getattr(p, 'is_junction', lambda: False)(), f'Link refused: {p}'
            p.resolve().relative_to(root)
            if not p.is_file():
                continue
            dst = root / destination(p.relative_to(root))
            dst.resolve().relative_to(root)
            key = str(dst).casefold()
            assert key not in targets and not dst.exists(), f'Target collision: {dst}'
            targets.add(key)
            moves.append((p, dst, p.stat().st_mtime_ns, hashlib.sha256(p.read_bytes()).digest()))
    print(f'{len(moves)} files to group; no overwrites')
    if not args.apply:
        return
    for src, dst, mtime, digest in moves:
        dst.parent.mkdir(parents=True, exist_ok=True)
        # Path.rename refuses an existing destination on Windows.
        src.rename(dst)
        assert dst.stat().st_mtime_ns == mtime and hashlib.sha256(dst.read_bytes()).digest() == digest, f'Verification failed: {dst}'
    for folder in ('meshes', 'textures', 'SKSE'):
        source = root / folder
        if source.is_dir():
            for p in sorted((p for p in source.rglob('*') if p.is_dir()), key=lambda p: len(p.parts), reverse=True):
                p.rmdir()
            source.rmdir()
    print(f'Moved {len(moves)} files; SHA-256 + timestamps verified. NIF bytes unchanged.')


if __name__ == '__main__':
    assert destination(Path('meshes/hairs/Xiaoyu Hair/a.nif')) == Path('hair/meshes/Xiaoyu Hair/a.nif')
    assert destination(Path('textures/!UBE/Head/a.dds')) == Path('head/textures/!UBE/Head/a.dds')
    assert destination(Path('textures/Caenarvon/Cosplay/a.dds')) == Path('clothing/textures/Caenarvon/Cosplay/a.dds')
    assert destination(Path('textures/cubemaps/a.dds')) == Path('shared/textures/cubemaps/a.dds')
    main()
