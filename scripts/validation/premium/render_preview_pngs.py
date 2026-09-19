#!/usr/bin/env python3
"""Render exported cells, not alternative layouts. Optional development-only Pillow.

Usage: python3 scripts/validation/premium/render_preview_pngs.py /path/to/previews
Set BOREAL_PREVIEW_FONT to an installed monospaced TTF when DejaVu is unavailable.
No fonts are copied into the output. Colours show a reference ANSI palette;
actual terminal colour mappings remain under the user's terminal preferences.
"""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory',type=Path)
    args=parser.parse_args()
    font_path=os.environ.get('BOREAL_PREVIEW_FONT','/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf')
    font=ImageFont.truetype(font_path,18)
    title_font=ImageFont.truetype(font_path,15)
    cw=11; ch=24; pad=24; top=86; bottom=24
    for file in sorted(args.directory.glob('*.cells.json')):
        data=json.loads(file.read_text());light=data['theme']=='light';mono=data['theme']=='mono'
        bg='#f7f8fa' if light else '#10151c';fg='#263344' if light else '#d4dde7'
        muted='#657385' if light else '#8b99aa';accent='#175ccd' if light else '#52cfea'
        tones={'text':fg,'muted':muted,'heading':fg,'accent':accent,'good':'#24764c' if light else '#77c893',
               'warn':'#896314' if light else '#e4ba61','danger':'#b62c42' if light else '#ed8796','border':muted,'selected':bg}
        if mono:tones={k:fg for k in tones}
        width=data['width']*cw+pad*2;height=data['height']*ch+top+bottom
        im=Image.new('RGB',(width,height),bg);d=ImageDraw.Draw(im)
        title=f"BOREAL WORK  /  {data['width']} x {data['height']}"
        d.text((pad,16),title,font=title_font,fill=accent if not mono else fg)
        d.text((pad,42),data['description'][:max(1,(width-2*pad)//9)],font=title_font,fill=muted)
        d.line((pad,70,width-pad,70),fill=muted)
        for y,row in enumerate(data['cells']):
            for x,cell in enumerate(row):
                if cell.get('continuation'):continue
                left=pad+x*cw;yy=top+y*ch
                if cell['tone']=='selected' and not mono:
                    span=2 if x+1<len(row) and row[x+1].get('continuation') else 1
                    d.rectangle((left,yy,left+cw*span-1,yy+ch-1),fill=fg)
                d.text((left,yy),cell['text'],font=font,fill=tones[cell['tone']])
        out=file.with_name(file.name.replace('.cells.json','.png'))
        im.save(out)
    print('PNG previews rendered from exported cells; no font files included.')


if __name__=='__main__':main()
