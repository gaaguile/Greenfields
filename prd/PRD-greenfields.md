# PRD: [Nombre del feature]

> Instrucciones de uso: copia este archivo por cada feature nuevo, complétalo, y pégalo como primer mensaje a Claude Code o Copilot Chat antes de pedir código. Si algo no aplica, bórralo — un PRD corto y preciso funciona mejor que uno largo con secciones vacías.

## 1. Objetivo
[Qué problema resuelve esto, en 1-3 líneas. Enfócate en el "por qué", no en el "cómo".]

Ejemplo: "Permitir que un evento local en mi PC dispare el envío de un reporte por WhatsApp vía Twilio, sin exponer credenciales ni puertos."

## 2. Contexto técnico

- **Stack:** TypeScript, Cloudflare Pages Functions, [Node/Python si aplica]
- **Repo/proyecto:** [nombre, ruta, o URL]
- **Integraciones externas:** [Twilio, APIs de datos, etc.]
- **Almacenamiento:** [KV / D1 / ninguno]
- **Constraints de seguridad:** [ej. secrets nunca en el cliente, HMAC en webhooks, no exponer puertos]
- **Convenciones del proyecto:** [ej. preferís %D sobre %K, nombres de archivo, estructura de carpetas existente]

## 3. Requisitos funcionales

Lista concreta y verificable de lo que el código debe hacer:

- [ ] Requisito 1
- [ ] Requisito 2
- [ ] Requisito 3

## 4. Requisitos no funcionales (si aplica)

- **Performance:** [ej. debe correr en <2s, cron cada 5 min]
- **Manejo de errores:** [ej. retry con backoff, logging, alertas]
- **Compatibilidad:** [ej. debe correr en Pi/ARM64, o en Cloudflare Workers runtime — sin APIs de Node no soportadas]

## 5. Fuera de alcance

Qué explícitamente NO debe tocar, cambiar, o incluir:

- [ej. no modificar la lógica del screener existente]
- [ej. no agregar dependencias nuevas sin avisar]
- [ej. no cambiar la API pública de X función]

## 6. Criterios de éxito / Definición de "listo"

Cómo sabés que el resultado funcionó:

- [ ] [ej. el mensaje llega a WhatsApp en <10s]
- [ ] [ej. build de Cloudflare Pages pasa sin errores de tipos]
- [ ] [ej. tests existentes siguen pasando]

## 7. Datos de ejemplo / casos de prueba (opcional)

```
[Input de ejemplo → output esperado, o un payload/JSON de muestra]
```

---

### Prompt sugerido para pegar junto con este PRD:

> Antes de escribir código, proponeme un plan de implementación basado en este PRD (archivos a crear/modificar, decisiones de arquitectura clave). Esperá mi confirmación antes de tocar código.
