import neo4j from 'neo4j-driver';

let driver = null;

export async function connectNeo4j() {
    if (driver) {
        console.log('✅ Neo4j already connected');
        return driver;
    }

    try {
        driver = neo4j.driver(
            process.env.NEO4J_URI,
            neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD),
            {
                maxConnectionLifetime: 3 * 60 * 60 * 1000, // 3 hours
                maxConnectionPoolSize: 50,
                connectionAcquisitionTimeout: 5000, // 5 seconds
                disableLosslessIntegers: true
            }
        );

        // Verify connectivity with timeout
        const session = driver.session();
        await Promise.race([
            session.run('RETURN 1'),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), 5000))
        ]);
        await session.close();

        console.log('✅ Neo4j connected successfully');
        return driver;
    } catch (error) {
        console.warn('⚠️  Neo4j connection failed - running without graph database');
        console.warn('   Graph relationships will be unavailable');
        driver = null;
        return null;
    }
}

export function getNeo4jDriver() {
    if (!driver) {
        throw new Error('Neo4j driver is not initialized');
    }
    return driver;
}

export async function runNeo4jQuery(query, params = {}) {
    if (!driver) {
        console.warn('⚠️  Neo4j driver not initialized - skipping query');
        return { records: [] };
    }
    const session = driver.session();
    try {
        const result = await session.run(query, params);
        return result;
    } catch (error) {
        console.error('Neo4j query error:', error);
        throw error;
    } finally {
        await session.close();
    }
}

export async function closeNeo4j() {
    if (driver) {
        await driver.close();
        driver = null;
        console.log('Neo4j connection closed');
    }
}

// Initialize graph schema
export async function initializeGraphSchema() {
    try {
        const session = driver.session();

        // Create constraints and indexes
        const constraints = [
            'CREATE CONSTRAINT institution_id IF NOT EXISTS FOR (i:Institution) REQUIRE i.id IS UNIQUE',
            'CREATE CONSTRAINT branch_id IF NOT EXISTS FOR (b:Branch) REQUIRE b.id IS UNIQUE',
            'CREATE CONSTRAINT course_id IF NOT EXISTS FOR (c:Course) REQUIRE c.id IS UNIQUE',
            'CREATE CONSTRAINT content_id IF NOT EXISTS FOR (ct:Content) REQUIRE ct.id IS UNIQUE',
            'CREATE CONSTRAINT concept_name IF NOT EXISTS FOR (cn:Concept) REQUIRE cn.name IS UNIQUE',
            'CREATE INDEX concept_difficulty IF NOT EXISTS FOR (cn:Concept) ON (cn.difficulty)',
            'CREATE CONSTRAINT answer_confidence IF NOT EXISTS FOR (a:Answer) ON (a.confidence)',
            'CREATE VECTOR INDEX doubt_vector_index IF NOT EXISTS FOR (q:Question) ON (q.embedding) OPTIONS {indexConfig: {`vector.dimensions`: 384, `vector.similarity_function`: "cosine"}}'
        ];

        for (const constraint of constraints) {
            try {
                await session.run(constraint);
            } catch (error) {
                // Constraint might already exist
                if (!error.message.includes('already exists')) {
                    console.error('Error creating constraint:', error);
                }
            }
        }

        await session.close();
        console.log('✅ Neo4j schema initialized');
    } catch (error) {
        console.error('❌ Failed to initialize Neo4j schema:', error);
    }
}
