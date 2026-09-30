"""Extract the v2.1 workbook; build-workbook.ts compiles its qualitative rules."""
import json
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

app = Path(__file__).resolve().parents[1]
source = Path(sys.argv[1]) if len(sys.argv) > 1 else app.parents[1] / 'Rebyters_Mammal_EXE_Evolution_Graph_v2_1.xlsx'
ns = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(source) as archive:
    strings = []
    if 'xl/sharedStrings.xml' in archive.namelist():
        strings = [''.join(n.itertext()) for n in ET.fromstring(archive.read('xl/sharedStrings.xml')).findall('m:si', ns)]
    def rows(sheet):
        result = []
        for row in ET.fromstring(archive.read(f'xl/worksheets/sheet{sheet}.xml')).findall('.//m:sheetData/m:row', ns):
            cells = {}
            for cell in row:
                value = cell.find('m:v', ns)
                inline = cell.find('m:is', ns)
                value = value.text if value is not None else ''.join(inline.itertext()) if inline is not None else ''
                column = ''.join(c for c in cell.get('r') if c.isalpha())
                cells[column] = strings[int(value)] if cell.get('t') == 's' else value
            result.append(cells)
        return [{label: row.get(column, '') for column, label in result[0].items()} for row in result[1:]]
    nodes, links = rows(2), rows(3)
stages = ['BIT', 'BYTE', 'KYLO', 'MEGA', 'GIGA', 'TERA']
evolutions = []
for row in nodes:
    evolutions.append(dict(id=int(row['ID']), key=row['Name'].lower().replace(' ', '_'), name=row['Name'], stage=stages.index(row['Stage']), family=row['Family'], visualDescription=row['Visual direction'], description=row['Gameplay role'], rarity=row['Rarity'].lower() if row['Rarity'].lower() in ['common','uncommon','rare','ultra'] else 'rare', enabled=True, initialWeight=10, modelUri='', assets={}, paths=[]))
by_name = {e['name']: e for e in evolutions}
for row in links:
    by_name[row['From']]['paths'].append(dict(target=by_name[row['To']]['id'], requiredGroupCount=0, priority=0, requirements=[], designRule={k:v for k,v in row.items() if k not in ['From','To']}))
tree = dict(schema=1, family=dict(id=0,name='Mammal'), version=1, development=True, evolutions=evolutions)
(app / 'src/lib/rebyters/mammal.workbook.json').write_text(json.dumps(tree, indent=2)+'\n')
print(f'Imported {len(evolutions)} creatures and {len(links)} connections from {source.name}')
