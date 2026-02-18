import { runNeo4jQuery } from '../../config/neo4j.config.js';

/**
 * Create content node in Neo4j
 * @param {Object} content - Content document from MongoDB
 * @returns {Promise<string>} Neo4j node ID
 */
export const createContentNode = async (content) => {
    try {
        const result = await runNeo4jQuery(
            `CREATE (c:Content {
                id: $id,
                title: $title,
                type: $type,
                createdAt: datetime(),
                difficulty: $difficulty
            })
            RETURN c`,
            {
                id: content._id.toString(),
                title: content.title,
                type: content.type,
                difficulty: content.metadata?.difficulty || 'intermediate'
            }
        );

        return result.records[0]?.get('c').identity.toString();
    } catch (error) {
        console.error('Create content node error:', error);
        throw error;
    }
};

/**
 * Link content to course in Neo4j
 * @param {string} contentId - Content MongoDB ID
 * @param {string} courseId - Course MongoDB ID
 */
export const linkContentToCourse = async (contentId, courseId) => {
    try {
        await runNeo4jQuery(
            `MATCH (content:Content {id: $contentId})
             MATCH (course:Course {id: $courseId})
             MERGE (course)-[:HAS_CONTENT]->(content)`,
            {
                contentId: contentId.toString(),
                courseId: courseId.toString()
            }
        );
    } catch (error) {
        console.error('Link content to course error:', error);
        throw error;
    }
};

/**
 * Create topic nodes from extracted topics
 * @param {string} contentId - Content MongoDB ID
 * @param {Array} topics - Array of topic strings
 */
export const createTopicNodes = async (contentId, topics) => {
    try {
        for (const topic of topics) {
            // Create or merge topic node
            await runNeo4jQuery(
                `MERGE (t:Topic {name: $topicName})
                 WITH t
                 MATCH (c:Content {id: $contentId})
                 MERGE (c)-[:COVERS]->(t)`,
                {
                    topicName: topic.toLowerCase().trim(),
                    contentId: contentId.toString()
                }
            );
        }
    } catch (error) {
        console.error('Create topic nodes error:', error);
        throw error;
    }
};

/**
 * Create concept nodes from extracted concepts
 * @param {string} contentId - Content MongoDB ID
 * @param {Array} concepts - Array of concept objects
 */
export const createConceptNodes = async (contentId, concepts) => {
    try {
        for (const concept of concepts) {
            await runNeo4jQuery(
                `MERGE (con:Concept {name: $conceptName})
                 ON CREATE SET con.description = $description
                 WITH con
                 MATCH (c:Content {id: $contentId})
                 MERGE (c)-[:TEACHES {importance: $importance}]->(con)`,
                {
                    conceptName: concept.name.toLowerCase().trim(),
                    description: concept.description || '',
                    importance: concept.importance || 0.5,
                    contentId: contentId.toString()
                }
            );
        }
    } catch (error) {
        console.error('Create concept nodes error:', error);
        throw error;
    }
};

/**
 * Create prerequisite relationships between content
 * @param {string} contentId - Content MongoDB ID
 * @param {Array} prerequisiteIds - Array of prerequisite content IDs
 */
export const createPrerequisites = async (contentId, prerequisiteIds) => {
    try {
        for (const prereqId of prerequisiteIds) {
            await runNeo4jQuery(
                `MATCH (c:Content {id: $contentId})
                 MATCH (p:Content {id: $prereqId})
                 MERGE (p)-[:PREREQUISITE_FOR]->(c)`,
                {
                    contentId: contentId.toString(),
                    prereqId: prereqId.toString()
                }
            );
        }
    } catch (error) {
        console.error('Create prerequisites error:', error);
        throw error;
    }
};

/**
 * Link related content based on shared topics
 * @param {string} contentId - Content MongoDB ID
 */
export const linkRelatedContent = async (contentId) => {
    try {
        // Find and link content with shared topics
        await runNeo4jQuery(
            `MATCH (c1:Content {id: $contentId})-[:COVERS]->(t:Topic)<-[:COVERS]-(c2:Content)
             WHERE c1 <> c2
             WITH c1, c2, count(t) as sharedTopics
             WHERE sharedTopics >= 2
             MERGE (c1)-[r:RELATED_TO]-(c2)
             SET r.strength = sharedTopics`,
            {
                contentId: contentId.toString()
            }
        );
    } catch (error) {
        console.error('Link related content error:', error);
        throw error;
    }
};

/**
 * Get learning path for a course
 * @param {string} courseId - Course MongoDB ID
 * @returns {Promise<Array>} Ordered content path
 */
export const getLearningPath = async (courseId) => {
    try {
        const result = await runNeo4jQuery(
            `MATCH (course:Course {id: $courseId})-[:HAS_CONTENT]->(c:Content)
             OPTIONAL MATCH path = (c)-[:PREREQUISITE_FOR*]->(next:Content)
             WITH c, length(path) as depth
             ORDER BY depth DESC
             RETURN c.id as contentId, c.title as title, c.type as type, depth`,
            {
                courseId: courseId.toString()
            }
        );

        return result.records.map(record => ({
            contentId: record.get('contentId'),
            title: record.get('title'),
            type: record.get('type'),
            depth: record.get('depth')
        }));
    } catch (error) {
        console.error('Get learning path error:', error);
        throw error;
    }
};

/**
 * Get recommended content based on what student has viewed
 * @param {string} studentId - Student MongoDB ID
 * @param {number} limit - Number of recommendations
 * @returns {Promise<Array>} Recommended content
 */
export const getRecommendations = async (studentId, limit = 5) => {
    try {
        const result = await runNeo4jQuery(
            `MATCH (s:User {id: $studentId})-[:VIEWED]->(c:Content)-[:COVERS]->(t:Topic)
             MATCH (t)<-[:COVERS]-(rec:Content)
             WHERE NOT (s)-[:VIEWED]->(rec)
             WITH rec, count(DISTINCT t) as relevance
             ORDER BY relevance DESC
             LIMIT $limit
             RETURN rec.id as contentId, rec.title as title, rec.type as type, relevance`,
            {
                studentId: studentId.toString(),
                limit: limit
            }
        );

        return result.records.map(record => ({
            contentId: record.get('contentId'),
            title: record.get('title'),
            type: record.get('type'),
            relevance: record.get('relevance').toNumber()
        }));
    } catch (error) {
        console.error('Get recommendations error:', error);
        throw error;
    }
};

/**
 * Record student viewing content
 * @param {string} studentId - Student MongoDB ID
 * @param {string} contentId - Content MongoDB ID
 */
export const recordView = async (studentId, contentId) => {
    try {
        await runNeo4jQuery(
            `MATCH (s:User {id: $studentId})
             MATCH (c:Content {id: $contentId})
             MERGE (s)-[v:VIEWED]->(c)
             ON CREATE SET v.firstViewedAt = datetime(), v.viewCount = 1
             ON MATCH SET v.lastViewedAt = datetime(), v.viewCount = v.viewCount + 1`,
            {
                studentId: studentId.toString(),
                contentId: contentId.toString()
            }
        );
    } catch (error) {
        console.error('Record view error:', error);
        throw error;
    }
};

/**
 * Get content graph visualization data
 * @param {string} courseId - Course MongoDB ID
 * @returns {Promise<Object>} Graph data for visualization
 */
export const getContentGraph = async (courseId) => {
    try {
        const result = await runNeo4jQuery(
            `MATCH (course:Course {id: $courseId})-[:HAS_CONTENT]->(c:Content)
             OPTIONAL MATCH (c)-[r:COVERS|TEACHES|PREREQUISITE_FOR|RELATED_TO]-(related)
             OPTIONAL MATCH (c)<-[drel:RELATES_TO]-(d:Doubt)
             RETURN c, collect(DISTINCT {rel: r, node: related}) as relationships, collect(DISTINCT {rel: drel, node: d}) as doubts`,
            {
                courseId: courseId.toString()
            }
        );

        const nodes = [];
        const edges = [];
        const nodeIds = new Set();

        result.records.forEach(record => {
            const content = record.get('c').properties;
            const contentId = content.id;

            if (!nodeIds.has(contentId)) {
                nodes.push({
                    id: contentId,
                    label: content.title,
                    type: content.type,
                    difficulty: content.difficulty
                });
                nodeIds.add(contentId);
            }

            const relationships = record.get('relationships');
            relationships.forEach(rel => {
                if (rel.rel && rel.node) {
                    const relatedId = rel.node.properties.id || rel.node.properties.name; // Fallback for Topic/Concept

                    if (!nodeIds.has(relatedId)) {
                        nodes.push({
                            id: relatedId,
                            label: rel.node.properties.title || rel.node.properties.name,
                            type: rel.node.labels[0]
                        });
                        nodeIds.add(relatedId);
                    }

                    edges.push({
                        source: contentId,
                        target: relatedId,
                        type: rel.rel.type
                    });
                }
            });

            const doubts = record.get('doubts');
            doubts.forEach(item => {
                if (item.node && item.rel) {
                    // Doubt nodes might not have an 'id' property, so we use their identity or generate one
                    const doubtProps = item.node.properties;
                    // Use identity if available, else fallback to hashing queryKey or similar. 
                    // Javascript neo4j driver integers: item.node.identity.toString() works.
                    const doubtId = item.node.identity ? item.node.identity.toString() : `doubt_${doubtProps.queryKey.substring(0, 10)}`;

                    if (!nodeIds.has(doubtId)) {
                        nodes.push({
                            id: doubtId,
                            label: doubtProps.query, // Show the question
                            type: 'Doubt',
                            answer: doubtProps.answer, // Pass answer to frontend
                            confidence: doubtProps.confidence
                        });
                        nodeIds.add(doubtId);
                    }

                    edges.push({
                        source: doubtId, // Doubt relates to Content
                        target: contentId,
                        type: 'RELATES_TO'
                    });
                }
            });
        });

        return { nodes, edges };
    } catch (error) {
        console.error('Get content graph error:', error);
        throw error;
    }
};

/**
 * Delete content node from Neo4j
 * @param {string} contentId - Content MongoDB ID
 */
export const deleteContentNode = async (contentId) => {
    try {
        await runNeo4jQuery(
            `MATCH (c:Content {id: $contentId})
             DETACH DELETE c`,
            {
                contentId: contentId.toString()
            }
        );
    } catch (error) {
        console.error('Delete content node error:', error);
        throw error;
    }
};

export default {
    createContentNode,
    linkContentToCourse,
    createTopicNodes,
    createConceptNodes,
    createPrerequisites,
    linkRelatedContent,
    getLearningPath,
    getRecommendations,
    recordView,
    getContentGraph,
    deleteContentNode
};
