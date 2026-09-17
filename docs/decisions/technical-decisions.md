# Decisiones estratégicas de Selene-IA: servidor gratis, capacidades del asistente y nivel empresa

Este documento registra las 5 decisiones estratégicas discutidas y aprobadas por el líder del equipo antes de arrancar la Fase F0 (Estabilización). Está escrito para el equipo de desarrollo de Monolith Studio: cada término técnico se define entre paréntesis la primera vez que aparece, las secciones son cortas a propósito y hay tablas y checklists en lugar de párrafos densos. **Veredicto en una frase:** el servidor propio arranca en cero dólares, las capacidades del asistente en F3 quedan delimitadas, la versatilidad multi-empresa se resuelve con el patrón driver/adaptador, los modelos de IA se conectan por una interfaz única con opciones gratuitas y el "nivel empresa" de F4 se define por evidencia demostrable, no por promesas.

## 1. Contexto breve

| Dato | Detalle |
|------|---------|
| Qué es | **Selene-IA**, un asistente de inteligencia artificial (IA) para empresas, propiedad de Monolith Studio (equipo independiente de desarrollo liderado por Eric Reyes) |
| Estado actual | Chat inteligente en JavaScript puro (aproximadamente 3.400 líneas), conectado a Gemini (el modelo de IA de Google) y Firebase (plataforma de Google que provee base de datos y login) |
| Evaluación | Arquitectura evaluada por completo; la evaluación vive en el documento de referencia del proyecto |
| Plan aprobado | F0 (Estabilización) → F1 (Servidor mínimo) → F2 (Núcleo separado + pruebas) → F3 (Capacidades de asistente) → F4 (Nivel empresa) |
| Estado de estas decisiones | Discutidas y aprobadas por el líder ANTES de arrancar F0 |

## 2. Decisión 1 — Servidor propio: sí se puede empezar gratis (costos minimizados)

**Respuesta: SÍ, con piezas gratuitas.** La pregunta de origen fue: ¿podemos tener nuestro propio servidor sin pagar? Cuanto menos gastos, mayor porcentaje de ganancia.

| Pieza | Opción gratuita |
|-------|-----------------|
| Ejecución de código | Cloudflare Workers (plataforma de Cloudflare que ejecuta nuestra aplicación en servidores distribuidos): 100.000 requests (peticiones) por día gratis |
| Backend con base de datos y autenticación | Supabase (plataforma open-source que combina base de datos y login): 500 MB y hasta 50.000 usuarios |
| Archivos y conocimiento empresarial | Cloudflare R2 (almacenamiento de objetos de Cloudflare): 10 GB, con egress (tráfico de salida) gratis |
| Base de datos vectorial para RAG (técnica en la que la IA busca en los documentos de la empresa antes de responder) | Supabase con pgvector (extensión de la base de datos PostgreSQL para búsquedas por similitud semántica) |
| Modelo de IA | Gemini free tier (capa gratuita del modelo de Google) o Groq (proveedor de modelos de IA con capa gratuita) |

Alternativas disponibles por si un cliente las exige:

| Alternativa | Qué ofrece |
|-------------|------------|
| Fly.io | 3 máquinas virtuales (VM: servidores simulados por software) gratis de 256 MB cada una |
| Render | Servicio web gratuito, con pausa automática por inactividad |
| Oracle Cloud Always Free | 4 CPU ARM y 24 GB de RAM gratis de por vida; configuración difícil |

Las 4 advertencias del "gratis":

1. **Cold starts (arranques en frío):** los servicios duermen tras un tiempo sin uso; el primer usuario de la mañana espera entre 5 y 15 segundos.
2. **Límites:** 100.000 peticiones por día se agotan rápido, porque un asistente hace varias llamadas por cada mensaje del usuario.
3. **Residencia de datos (dónde viven físicamente los datos):** el GDPR (Reglamento General de Protección de Datos: ley europea sobre el tratamiento de datos personales) y las empresas reguladas exigen saber dónde están los datos.
4. **El costo real del producto NO es el servidor, es el modelo de IA:** un VPS (servidor privado virtual: una máquina virtual alquilada con acceso completo) de 5 dólares al mes es nada comparado con las llamadas a los modelos.

**Recomendación:** arrancar en $0 (cero dólares de costo mensual) con Cloudflare Workers + Supabase + R2 + Gemini/Groq en sus capas gratuitas. La arquitectura hexagonal (código organizado en un núcleo propio rodeado de adaptadores que lo conectan con el mundo exterior) hace que el hosting (el servicio que aloja la aplicación) sea un detalle de configuración: cuando llegue el primer cliente que pague, migrar a un VPS barato (Hetzner, aproximadamente 5 dólares al mes) o al hosting que el cliente pida, sin tocar el núcleo. Gratis para arrancar, barato para escalar.

## 3. Decisión 2 — Fase 3: capacidades mínimas del asistente empresarial

"**Asistente empresarial**" no es un chatbot (programa que conversa) con mejor prompt (instrucción que se le da a la IA para guiar su respuesta). Estas son las 9 capacidades mínimas que definen a un asistente empresarial:

| Capacidad | Qué significa | ¿Se construye en F3? |
|-----------|---------------|----------------------|
| 1. Conversación con contexto de la empresa | Responde sobre productos, horarios y políticas del negocio con RAG sobre sus documentos | SÍ |
| 2. Acceso a datos estructurados | Consulta la base de datos de la empresa (inventario, clientes, órdenes); ejemplo: "¿cuántas unidades de X hay?" | SÍ |
| 3. Acciones transaccionales | Crea o actualiza registros con confirmación; ejemplo: "crea un cliente nuevo" | Básico |
| 4. Comunicaciones salientes | Envía correos y mensajes por WhatsApp, Slack o Telegram | SÍ |
| 5. Agenda y recordatorios | Crea eventos y avisa vencimientos | NO, F4 |
| 6. Alertas proactivas | Selene avisa "se acabó el stock de X" sin que le pregunten | NO, F4 |
| 7. Escalamiento humano | Cuando no sabe o no tiene permiso, deriva al humano correcto | SÍ |
| 8. Auditoría completa | Registro inmutable (que no se puede modificar) de qué pidió quién, qué hizo Selene y con qué datos | SÍ |
| 9. Permisos por rol RBAC (control de acceso basado en roles) | Selene nunca hace más de lo que el usuario puede hacer | SÍ |

**Regla de oro:** cada capacidad nace CON su auditoría y sus permisos. La auditoría (el registro detallado de toda acción) no se agrega después.

**Lo que NO se hace en F3:** conectarse al ERP (sistema de planificación de recursos empresariales) o CRM (sistema de gestión de relaciones con clientes) específico de un cliente. Eso es trabajo de F4, con el mecanismo de la Decisión 3.

## 4. Decisión 3 — Versatilidad multi-empresa: patrón driver/adaptador (contrato canónico, no hardcoding)

La pregunta de origen fue: Selene está pensada para varias empresas, no para un solo sector; ¿cómo se adapta a los sistemas exclusivos de cada empresa?

**Respuesta: con el patrón driver/adaptador, como las impresoras.** No se escribe software distinto por impresora: los fabricantes implementan un contrato estándar y la aplicación habla con cualquiera. Selene seguirá la misma lógica.

**Paso 1 — Contrato canónico de capacidades.** Selene declara qué sabe hacer en términos genéricos, por ejemplo: `consultarInventario(producto)` → cantidad; `crearCliente(datos)` → id; `enviarCorreo(destino, asunto, cuerpo)` → estado. El núcleo (el cerebro) SOLO conoce ese contrato; no sabe qué ERP usa cada cliente. Hardcoding (escribir la lógica de un cliente específico dentro del código) queda prohibido.

**Paso 2 — Adaptadores por empresa.** Al suscribirse una empresa se escribe UN adaptador (pieza que traduce el contrato canónico al sistema real) por sistema:

| Sistema de la empresa | Tipo de adaptador |
|-----------------------|-------------------|
| SQL (lenguaje para consultar bases de datos) | Queries (consultas) con permisos |
| SAP, Tally, Odoo | API REST (interfaz de programación: reglas estándar para que dos programas se comuniquen) |
| Google Sheets | Lectura de la planilla (muchas pymes viven en planillas) |

**Paso 3 — Multi-tenancy estricto.** Cada empresa (tenant: empresa cliente que usa el mismo sistema) tiene su propio índice de conocimiento (RAG) y su configuración declarativa (qué sistemas tiene, qué permisos tiene Selene, qué proveedor de modelo usa). Los datos de una empresa son invisibles para las demás.

**Resultado de negocio:** se vende UNA vez el núcleo; los adaptadores son integraciones cobradas por proyecto. Cada cliente nuevo es más barato de integrar que el anterior, gracias a los conectores reutilizables (SQL, planillas, WhatsApp, correo). Por eso la arquitectura hexagonal ES la versatilidad.

## 5. Decisión 4 — Multi-proveedor de modelos + modelos gratuitos iniciales

**Corrección conceptual importante:** Codex, Cursor y OpenCode NO son proveedores de modelos: son clientes o herramientas de código que usa nuestro equipo, no Selene. Los proveedores de modelos son Anthropic (Claude), OpenAI (GPT), Google (Gemini), Mistral y Meta (Llama).

**Solución:** una interfaz única con dos operaciones — `conversar(mensajes, herramientas)` y `buscarEmbeddings(texto)` (embeddings: representaciones numéricas del significado de un texto, usadas para buscar por similitud) — más un adaptador por proveedor. Es la misma idea del contrato canónico de la Decisión 3.

| Proveedor | Perfil |
|-----------|--------|
| Gemini (Google) | Capa gratuita generosa; elección natural para arrancar |
| Groq | Gratis, rápido, con límites; ideal para tareas simples |
| Mistral | Capa gratuita; bueno para chat general |
| OpenRouter | Modelos gratuitos; un solo API para muchos modelos |
| Ollama (local) | Cero dólares por siempre; modelos open-source (de código abierto) en nuestro propio servidor |
| Anthropic / OpenAI | Pago; cuando el cliente quiera calidad premium |

**Router por empresa.** Cada tenant configura su política: proveedor principal, fallback (respaldo automático) si cae, presupuesto máximo y reglas de enrutamiento (tareas simples → modelo barato o gratuito; tareas complejas → modelo premium). Si el principal falla, Selene degrada con gracia (sigue funcionando con menor capacidad, sin romperse) hacia el fallback.

**Bundle Starter para pymes** (pequeñas y medianas empresas) sin presupuesto: Gemini free + Groq + RAG básico = cero costo de API mensual. Cuando crezcan, se cambia la configuración del tenant sin tocar código.

**Truco senior:** la abstracción (la interfaz única) se diseña UNA vez y los adaptadores se agregan después como plugins (componentes que se conectan sin modificar el núcleo). El costo de la IA es una decisión del cliente, no una limitación nuestra.

## 6. Decisión 5 — Qué significa "nivel empresarial" (F4): definición y garantía de estabilidad

"No funciona bien" NO es "listo para comercializar". Un producto alcanza nivel empresa cuando PUEDE PROBAR con evidencia (no con promesas) estas 9 propiedades:

| Pilar | Qué exige |
|-------|-----------|
| 1. Seguridad madura | Autenticación con SSO (inicio de sesión único: una sola cuenta para varios servicios) y roles; claves SOLO en el servidor; auditoría completa; reglas de base de datos versionadas (guardadas en el repositorio con historial de cambios) |
| 2. Multi-tenant aislado | Prueba de que una empresa no puede ver datos de otra |
| 3. Confiabilidad (SLO: objetivo de nivel de servicio) | Uptime (tiempo que el sistema permanece operativo) objetivo (ej. 99,5%); monitoreo (seguimiento continuo del estado del sistema); logs centralizados (registros de eventos reunidos en un solo lugar); alertas; backup (copia de seguridad) restaurado y PROBADO |
| 4. Cumplimiento legal | GDPR + leyes locales: retención de datos (cuánto tiempo se guardan), derecho al olvido (borrar los datos de un usuario cuando lo pide), consentimiento |
| 5. Operaciones | CI/CD (integración y entrega continuas: automatización que prueba y publica cada cambio); deploy automático (publicación automática de nuevas versiones); rollback (volver a una versión anterior) en 1 comando; migraciones de base de datos (cambios de esquema versionados) |
| 6. Control de costos | Métricas de gasto de IA por tenant y por cliente |
| 7. Escalabilidad | Pruebas de carga (pruebas de rendimiento con muchos usuarios) con números objetivos (ej. 50 usuarios simultáneos sin degradar) |
| 8. Soporte y SLA (acuerdo de nivel de servicio: contrato que define el soporte prometido) | Documentación; onboarding (proceso de incorporación) de clientes; canal de soporte; contrato de servicio |
| 9. Pruebas automatizadas | Unit (pruebas unitarias: prueban una función aislada) + integración + E2E (pruebas de extremo a extremo: prueban el flujo completo) verdes en cada release (versión publicada) |

Qué debe hacer Monolith para garantizarlo:

- [ ] **Definition of Done** (definición de "terminado": criterios que una entrega debe cumplir para considerarse completa) de release con evidencia: tests verdes, carga OK, auditoría completa, backup restaurado. No vale "probé y funciona".
- [ ] **Período de clientes beta:** 2–3 empresas reales usando el sistema durante 30 días, con monitoreo activo, ANTES de venderlo.
- [ ] **Plan de rollback y degradación:** si cae Gemini → fallback; si cae el servidor → tiempo de recuperación definido.
- [ ] **Documentación y proceso de soporte:** un producto sin soporte deja de venderse en la tercera queja.

**Grado de funcionamiento mínimo:** el sistema opera días sin intervención de Monolith; cualquier error de un proveedor externo degrada con gracia en lugar de romper; toda acción es auditable.

## 7. Resumen ejecutivo

| # | Decisión | Conclusión |
|---|----------|------------|
| 1 | Servidor propio | Servidor gratis: SÍ — Cloudflare + Supabase + R2 + Gemini/Groq = $0 hasta el primer cliente; después, VPS barato. La arquitectura hexagonal hace el hosting intercambiable. |
| 2 | Capacidades de F3 | RAG empresarial, acceso a base de datos, comunicación (correo/mensajes), escalamiento humano, auditoría y permisos desde el nacimiento. Transaccional y proactivo quedan para F4. |
| 3 | Versatilidad multi-empresa | Contrato canónico de capacidades + adaptadores por empresa + multi-tenant estricto. Los ERP se adaptan a Selene. |
| 4 | Multi-modelo | Interfaz única + adaptadores + router por tenant. Gratis inicial (Gemini/Groq/Ollama), pago cuando el cliente lo pida. |
| 5 | Nivel empresa (F4) | 9 pilares demostrables con evidencia + definition of done con números + clientes beta + plan de degradación. No es una feature (funcionalidad), es una postura. |