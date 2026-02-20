import { pipeline, type FeatureExtractionPipeline } from '@xenova/transformers';

let embedder: FeatureExtractionPipeline | null = null;
let loading: Promise<FeatureExtractionPipeline> | null = null;

async function getEmbedder(): Promise<FeatureExtractionPipeline> {
    if (embedder) return embedder;
    if (loading) return loading;

    loading = pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2').then(e => {
        embedder = e;
        console.log('[Embeddings] Model loaded');
        return e;
    });

    return loading;
}

export async function embed(text: string): Promise<number[]> {
    const model = await getEmbedder();
    const output = await model(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data as Float32Array);
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
    const model = await getEmbedder();
    const results: number[][] = [];
    for (const text of texts) {
        const output = await model(text, { pooling: 'mean', normalize: true });
        results.push(Array.from(output.data as Float32Array));
    }
    return results;
}

export function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
}
