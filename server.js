require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");

const app = express();
const PORT = process.env.PORT || 3000;

/* =====================================================
   MIDDLEWARES
===================================================== */

app.use(cors());
app.use(express.json());

/* =====================================================
   VALIDAR VARIABLES DE ENTORNO
===================================================== */

const variablesRequeridas = [
    "DB_HOST",
    "DB_PORT",
    "DB_USER",
    "DB_PASSWORD",
    "DB_NAME"
];

const variablesFaltantes = variablesRequeridas.filter(
    (variable) => !process.env[variable]
);

if (variablesFaltantes.length > 0) {
    console.error(
        "Faltan variables de entorno:",
        variablesFaltantes.join(", ")
    );

    process.exit(1);
}

/* =====================================================
   CONEXIÓN CON MYSQL DE AIVEN
===================================================== */

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,

    // Aiven requiere conexión SSL.
    ssl: {
        rejectUnauthorized: false
    },

    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

/* =====================================================
   PROBAR CONEXIÓN AL INICIAR
===================================================== */

async function probarConexion() {
    try {
        const conexion = await pool.getConnection();

        const [resultado] = await conexion.query(
            "SELECT DATABASE() AS base_actual"
        );

        console.log("Conexión exitosa con Aiven");
        console.log("Base seleccionada:", resultado[0].base_actual);

        conexion.release();
    } catch (error) {
        console.error("Error conectando con Aiven:");
        console.error(error.message);
    }
}

probarConexion();

/* =====================================================
   RUTA PRINCIPAL
===================================================== */

app.get("/", (req, res) => {
    res.json({
        status: "ok",
        mensaje: "API de Cocina Escolar funcionando"
    });
});

/* =====================================================
   PROBAR BASE DE DATOS
===================================================== */

app.get("/probar-conexion", async (req, res) => {
    try {
        const [resultado] = await pool.query(`
            SELECT
                DATABASE() AS base_actual,
                NOW() AS fecha_servidor
        `);

        res.json({
            status: "ok",
            mensaje: "Conexión con Aiven correcta",
            datos: resultado[0]
        });
    } catch (error) {
        console.error(error);

        res.status(500).json({
            status: "error",
            mensaje: "No se pudo conectar con la base de datos",
            error: error.message
        });
    }
});

/* =====================================================
   OBTENER ESTUDIANTES
===================================================== */

app.get("/estudiantes", async (req, res) => {
    try {
        const [estudiantes] = await pool.query(`
            SELECT id, nombre, carnet, codigo_barra
            FROM estudiantes
            ORDER BY nombre ASC
        `);

        res.json(estudiantes);
    } catch (error) {
        console.error(error);

        res.status(500).json({
            status: "error",
            mensaje: "No se pudieron obtener los estudiantes"
        });
    }
});

/* =====================================================
   REGISTRAR ESTUDIANTE
===================================================== */

app.post("/estudiantes", async (req, res) => {
    try {
        const { nombre, carnet, codigo_barra } = req.body;

        if (!nombre || !carnet || !codigo_barra) {
            return res.status(400).json({
                status: "error",
                mensaje: "Nombre, carnet y código de barras son obligatorios"
            });
        }

        const [resultado] = await pool.query(
            `
            INSERT INTO estudiantes (
                nombre,
                carnet,
                codigo_barra
            )
            VALUES (?, ?, ?)
            `,
            [
                nombre.trim(),
                carnet.trim(),
                codigo_barra.trim()
            ]
        );

        res.status(201).json({
            status: "ok",
            mensaje: "Estudiante registrado correctamente",
            id: resultado.insertId
        });
    } catch (error) {
        console.error(error);

        if (error.code === "ER_DUP_ENTRY") {
            return res.status(409).json({
                status: "error",
                mensaje: "El carnet o código de barras ya está registrado"
            });
        }

        res.status(500).json({
            status: "error",
            mensaje: "No se pudo registrar el estudiante"
        });
    }
});

/* =====================================================
   OBTENER UTENSILIOS
===================================================== */

app.get("/utensilios", async (req, res) => {
    try {
        const [utensilios] = await pool.query(`
            SELECT id, tipo
            FROM utensilios
            ORDER BY tipo ASC
        `);

        res.json(utensilios);
    } catch (error) {
        console.error(error);

        res.status(500).json({
            status: "error",
            mensaje: "No se pudieron obtener los utensilios"
        });
    }
});

/* =====================================================
   REGISTRAR RETIRO
===================================================== */

app.post("/retiro", async (req, res) => {
    try {
        const estudianteId = Number(req.body.estudiante_id);
        const utensilioId = Number(req.body.utensilio_id);

        if (
            !Number.isInteger(estudianteId) ||
            estudianteId <= 0 ||
            !Number.isInteger(utensilioId) ||
            utensilioId <= 0
        ) {
            return res.status(400).json({
                status: "error",
                mensaje: "El estudiante y el utensilio no son válidos"
            });
        }

        const [estudiantes] = await pool.query(
            "SELECT id FROM estudiantes WHERE id = ?",
            [estudianteId]
        );

        if (estudiantes.length === 0) {
            return res.status(404).json({
                status: "error",
                mensaje: "El estudiante no existe"
            });
        }

        const [utensilios] = await pool.query(
            "SELECT id FROM utensilios WHERE id = ?",
            [utensilioId]
        );

        if (utensilios.length === 0) {
            return res.status(404).json({
                status: "error",
                mensaje: "El utensilio no existe"
            });
        }

        const [resultado] = await pool.query(
            `
            INSERT INTO movimientos (
                estudiante_id,
                utensilio_id,
                fecha_retiro
            )
            VALUES (?, ?, NOW())
            `,
            [estudianteId, utensilioId]
        );

        res.status(201).json({
            status: "ok",
            mensaje: "Retiro registrado correctamente",
            movimiento_id: resultado.insertId
        });
    } catch (error) {
        console.error(error);

        res.status(500).json({
            status: "error",
            mensaje: "No se pudo registrar el retiro"
        });
    }
});

/* =====================================================
   REGISTRAR DEVOLUCIÓN
===================================================== */

app.put("/devolucion/:id", async (req, res) => {
    try {
        const movimientoId = Number(req.params.id);

        if (!Number.isInteger(movimientoId) || movimientoId <= 0) {
            return res.status(400).json({
                status: "error",
                mensaje: "El ID del movimiento no es válido"
            });
        }

        const [resultado] = await pool.query(
            `
            UPDATE movimientos
            SET fecha_devolucion = NOW()
            WHERE id = ?
              AND fecha_devolucion IS NULL
            `,
            [movimientoId]
        );

        if (resultado.affectedRows === 0) {
            return res.status(404).json({
                status: "error",
                mensaje:
                    "El movimiento no existe o ya fue devuelto"
            });
        }

        res.json({
            status: "ok",
            mensaje: "Devolución registrada correctamente"
        });
    } catch (error) {
        console.error(error);

        res.status(500).json({
            status: "error",
            mensaje: "No se pudo registrar la devolución"
        });
    }
});

/* =====================================================
   LISTAR MOVIMIENTOS
===================================================== */

app.get("/movimientos", async (req, res) => {
    try {
        const [movimientos] = await pool.query(`
            SELECT
                m.id,
                e.nombre AS estudiante,
                e.carnet,
                e.codigo_barra,
                u.tipo AS utensilio,
                m.fecha_retiro,
                m.fecha_devolucion,
                CASE
                    WHEN m.fecha_devolucion IS NULL
                        THEN 'Pendiente'
                    ELSE 'Devuelto'
                END AS estado
            FROM movimientos AS m
            INNER JOIN estudiantes AS e
                ON e.id = m.estudiante_id
            INNER JOIN utensilios AS u
                ON u.id = m.utensilio_id
            ORDER BY m.fecha_retiro DESC
        `);

        res.json(movimientos);
    } catch (error) {
        console.error(error);

        res.status(500).json({
            status: "error",
            mensaje: "No se pudieron obtener los movimientos"
        });
    }
});

/* =====================================================
   LISTAR MOVIMIENTOS PENDIENTES
===================================================== */

app.get("/movimientos/pendientes", async (req, res) => {
    try {
        const [movimientos] = await pool.query(`
            SELECT
                m.id,
                e.nombre AS estudiante,
                e.carnet,
                e.codigo_barra,
                u.tipo AS utensilio,
                m.fecha_retiro
            FROM movimientos AS m
            INNER JOIN estudiantes AS e
                ON e.id = m.estudiante_id
            INNER JOIN utensilios AS u
                ON u.id = m.utensilio_id
            WHERE m.fecha_devolucion IS NULL
            ORDER BY m.fecha_retiro DESC
        `);

        res.json(movimientos);
    } catch (error) {
        console.error(error);

        res.status(500).json({
            status: "error",
            mensaje: "No se pudieron obtener los retiros pendientes"
        });
    }
});

// =====================================================
// REGISTRAR DEVOLUCIÓN MEDIANTE CARNET O CÓDIGO DE BARRAS
// =====================================================
app.put("/devolucionCarnet/:identificador", async (req, res) => {
    const identificador = req.params.identificador.trim();

    if (!identificador) {
        return res.status(400).json({
            status: "error",
            mensaje: "El carnet o código de barras es obligatorio"
        });
    }

    try {
        const [resultado] = await pool.query(
            `
            UPDATE movimientos
            SET fecha_devolucion = NOW()
            WHERE id = (
                SELECT movimiento_id
                FROM (
                    SELECT m.id AS movimiento_id
                    FROM movimientos AS m
                    INNER JOIN estudiantes AS e
                        ON e.id = m.estudiante_id
                    WHERE (
                        e.codigo_barra = ?
                        OR e.carnet = ?
                    )
                    AND m.fecha_devolucion IS NULL
                    ORDER BY m.fecha_retiro DESC
                    LIMIT 1
                ) AS ultimo_pendiente
            )
            AND fecha_devolucion IS NULL
            `,
            [identificador, identificador]
        );

        if (resultado.affectedRows === 0) {
            return res.status(404).json({
                status: "error",
                mensaje: "El estudiante no tiene utensilios pendientes"
            });
        }

        return res.status(200).json({
            status: "ok",
            mensaje: "Devolución registrada correctamente"
        });
    } catch (error) {
        console.error("Error registrando devolución:", error);

        return res.status(500).json({
            status: "error",
            mensaje: "No se pudo registrar la devolución"
        });
    }
});

/*informe diario*/
app.get("/informe" , async (req ,res) =>{
    try {
        const [informe] = await pool.query(`
            SELECT 
                u.tipo,
                COUNT(
                    CASE
                        WHEN m.fecha_devolucion IS NOT NULL
                        THEN 1
                    END
                ) AS devueltos ,
                COUNT(
                    CASE
                        WHEN m.id IS NOT NULL
                        AND m.fecha_devolucion IS NULL
                        THEN 1
                    END
                ) AS pendientes
                 FROM utensilios AS u
                 LEFT JOIN movimientos AS m
                 ON m.utensilio_id = u.id
                 AND DATE (m.fecha_retiro) = CURDATE()
                 GROUP BY u.id, u.tipo
                 ORDER BY u.tipo ASC`);
        res.json(informe);
    
} catch (error){
    console.error("Error generando informe: " , error);

    res.status(500).json({
        status: "Error",
        mensaje: "no se pudo generar el informe diario"
    });
}
});


/**INFORME HISTORICO POR FECHA */
app.get("/informe/:fecha" , async (req , res) => {
    const fecha =req.params.fecha.trim();

    //definir la aplicacion de fecha 
    const formatoFecha = /^\d{4}-\d{2}-\d{2}$/;

    if (!formatoFecha.test(fecha)){
        return res.status(400).json({
            status: "error",
            mensaje: "La fecha debe tener el formato YYY-MM-DD"
        });
    }

    try{
        const [informe] = await pool.query(
            `SELECT 
            u.tipo,
            COUNT(m.id) AS entregados,
            COUNT(
                CASE 
                    WHEN m.fecha_devolucion IS NOT NULL
                    THEN 1
                END
            ) AS devueltos,

            COUNT(
                CASE
                    WHEN a.id IS NOT NULL
                    AND m.fecha_devolucion IS NULL
                    THEN 1
                END
            ) AS pendientes

        FROM utensilios AS u
        LEFT JOIN movimientos AS m
            ON m.utencilio_id = u.id
        AND DATE(m.fecha_retiro) = ?

        GROUP BY u.id, u.tipo
        ORDER BY u.tipo ASC
            `,
            [fecha]
        );

        return res.status(200).json(informe);
    }catch (error){
        console.error ("Error generando informe historico:" , error);

        return res.status(500).json({
            status: "error",
            mensaje: " No se pudo generar el informe historico"
        });
    }
});

/**registro de retiro mediante codigo de barras */
app.post("/retiro/codigo" , async (req , res) => {
    try {
        const codigoBarra = String(
            req.body.codigo_barra ?? ""
        ).trim();
        const utensilioId = Number(req.body.utensilio_id);

        if(
            codigoBarra=== "" ||
            !Number.isInteger(utensilioId) ||
            utensilioId <=0
        ){
            return res.status(400).json({
                status: "error",
                mensaje:
                "El codigo de barras y el utensilio son obligatorios"
        
            });
        }
        const [estudiantes] = await pool.query(
            `
            SELECT id, nombre, carnet, codigo_barra
            FROM estudiantes
            WHERE codigo_barra = ?
               OR carnet = ?
            LIMIT 1
            `,
            [codigoBarra , codigoBarra]
        );
        if (estudiantes.length === 0){
            return res.status(404).json({
                status : "error",
                mensaje: "El carnet escaneado no esta registrado"

            });
        }
        const [utensilios] = await pool.query(
            "SELECT id FROM utensilios WHERE id =?",
            [utensilioId]
        );
         if (utensilios.length === 0) {
            return res.status(404).json({
                status: "error",
                mensaje: "El utensilio no existe"
            });
        }

        const estudiante = estudiantes[0];

        const [resultado] = await pool.query(
            `
            INSERT INTO movimientos (
                estudiante_id,
                utensilio_id,
                fecha_retiro
            )
            VALUES (?, ?, NOW())
            `,
            [estudiante.id, utensilioId]
        );

        res.status(201).json({
            status: "ok",
            mensaje:
                `Retiro registrado para ${estudiante.nombre}`,
            movimiento_id: resultado.insertId,
            estudiante: {
                id: estudiante.id,
                nombre: estudiante.nombre,
                carnet: estudiante.carnet
            }
        });
    } catch (error) {
        console.error(error);

        res.status(500).json({
            status: "error",
            mensaje: "No se pudo registrar el retiro"
        });
    }
});

/**consultaremos utensilios pendientes de un estudiante */

// =====================================================
// CONSULTAR UTENSILIOS PENDIENTES DE UN ESTUDIANTE
// =====================================================
app.get("/pendientes/:identificador", async (req, res) => {
    const identificador = req.params.identificador.trim();

    if (!identificador) {
        return res.status(400).json({
            status: "error",
            mensaje: "El carnet o código de barras es obligatorio"
        });
    }

    try {
        const [filas] = await pool.query(
            `
            SELECT
                e.id AS estudiante_id,
                e.nombre AS estudiante,
                e.carnet,
                e.codigo_barra,
                m.id AS movimiento_id,
                u.tipo,
                m.fecha_retiro
            FROM estudiantes AS e
            LEFT JOIN movimientos AS m
                ON m.estudiante_id = e.id
                AND m.fecha_devolucion IS NULL
            LEFT JOIN utensilios AS u
                ON u.id = m.utensilio_id
            WHERE e.codigo_barra = ?
               OR e.carnet = ?
            ORDER BY m.fecha_retiro DESC
            `,
            [identificador, identificador]
        );

        if (filas.length === 0) {
            return res.status(404).json({
                status: "error",
                mensaje: "El carnet escaneado no está registrado"
            });
        }

        const estudiante = {
            id: filas[0].estudiante_id,
            nombre: filas[0].estudiante,
            carnet: filas[0].carnet,
            codigo_barra: filas[0].codigo_barra
        };

        const pendientes = filas
            .filter((fila) => fila.movimiento_id !== null)
            .map((fila) => ({
                movimiento_id: fila.movimiento_id,
                tipo: fila.tipo,
                fecha_retiro: fila.fecha_retiro
            }));

        return res.status(200).json({
            status: "ok",
            estudiante,
            total: pendientes.length,
            pendientes
        });
    } catch (error) {
        console.error("Error consultando pendientes:", error);

        return res.status(500).json({
            status: "error",
            mensaje: "No se pudieron consultar los utensilios pendientes"
        });
    }
});

/* =====================================================
   RUTA NO ENCONTRADA
===================================================== */

app.use((req, res) => {
    res.status(404).json({
        status: "error",
        mensaje: "Ruta no encontrada"
    });
});

/* =====================================================
   INICIAR SERVIDOR
===================================================== */

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Servidor ejecutándose en el puerto ${PORT}`);
});