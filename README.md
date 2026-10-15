# Mapa de viajes

Web para el móvil para guardar restaurantes, lugares y fotos de viajes en un mapa.
Todo gratis: Leaflet + OpenStreetMap, datos guardados en el propio móvil (IndexedDB) y alojamiento en GitHub Pages.

## Publicarla en GitHub Pages

1. Crea un repositorio nuevo en GitHub (por ejemplo `mapa-viajes`).
2. Sube todos los archivos de esta carpeta a la raíz del repositorio.
3. Ve a **Settings → Pages**. En *Source*, elige **Deploy from a branch**, rama `main` y carpeta `/ (root)`. Guarda.
4. Al cabo de uno o dos minutos estará en `https://TU-USUARIO.github.io/mapa-viajes/`.

## Instalarla en el móvil

- **Android (Chrome):** abre la URL → menú ⋮ → *Añadir a pantalla de inicio* / *Instalar app*.
- **iPhone (Safari):** abre la URL → botón Compartir → *Añadir a pantalla de inicio*.

## Cómo se usa

- **+** o **mantener pulsado el mapa** → añadir un lugar. Mueve el mapa hasta que el pin quede encima del sitio, o busca la dirección.
- Pin **verde relleno** = ya fui · pin **con borde naranja** = quiero ir.
- **Copia** → exporta un archivo `.json` con todo (fotos incluidas). Guárdalo en Drive o iCloud. Con *Importar copia* lo recuperas en cualquier móvil.

## Importante

- Los datos viven **solo en el navegador del móvil** donde los creas. Haz copias de vez en cuando.
- El repositorio es público: se ve el código, pero **no** tus lugares ni tus fotos.
- Si cambias el código, sube la versión en `sw.js` (`mapa-viajes-v1` → `v2`) para que el móvil coja la versión nueva.
