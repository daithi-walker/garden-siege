# Garden Siege

A lane-defense browser game: plant a defense, collect sun, and hold off 12 waves of shamblers.
Everything is drawn procedurally on a `<canvas>`, with no assets and no dependencies.

## Play locally

```bash
python3 -m http.server 8765
# open http://localhost:8765
```

## Controls

| Action | Input |
| --- | --- |
| Collect sun | Click it |
| Pick a seed card | Click, or keys `1`-`6` |
| Plant | Click a lawn tile |
| Shovel | Click the shovel card, or `S` |
| Cancel selection | Right-click or `Esc` |
| Pause | `P` / Space |
| Toggle 2x speed | `F` |

## Plants

| Plant | Cost | Role |
| --- | --- | --- |
| Lantern Bloom | 50 | Produces sun |
| Reed Cannon | 100 | Fires seeds down its lane |
| Briar Hedge | 50 | High-HP wall |
| Frost Reed | 175 | Seeds slow shamblers |
| Twin Reed | 200 | Fires two seeds |
| Pine Grenade | 150 | Explodes in a 3x3 area |
