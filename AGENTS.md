# Reglas de trabajo de 3dLodMV

## Alcance

3dLodMV es un visor web local-first de CityJSON y capas geoespaciales. Usa
iTowns como framework GIS 3D y Three.js como renderer. No es un validador formal
de CityJSON, un editor ni un servidor de tiles.

## Datos y coordenadas

- Conservar IDs, atributos, relaciones explícitas, geometrías y LoD de origen.
- Aplicar `transform` CityJSON una sola vez.
- Transformar coordenadas en doble precisión y recentrar antes de crear buffers
  `float32`.
- Tratar CRS horizontal, unidades Z y referencia vertical como evidencias
  distintas. No inferir un datum por apariencia.
- No ajustar edificios al terreno ni alterar sus alturas sin una operación
  explícita y documentada.
- Las capas externas no pueden introducir credenciales en configuración
  versionada.

## Arquitectura

- Mantener separados parser CityJSON, geometría, escena, catálogo de capas e UI.
- Los tipos y defaults que controlen comportamiento se documentan junto a su
  dueño y se validan en el límite.
- Los adaptadores de capa son responsables de sus protocolos; no dispersar
  condicionales por proveedor en la interfaz.
- Conservar el recorrido local sin red cuando no haya capas externas activas.

## Verificación

- `npm test` para contratos geométricos y de configuración.
- `npm run build` antes de entregar cambios de aplicación.
- Cambios de carga, picking o interacción requieren prueba en navegador.
- Registrar procedencia, versión y licencia antes de incorporar código externo.
