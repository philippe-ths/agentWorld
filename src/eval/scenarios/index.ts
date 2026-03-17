import { TestScenario } from '../types';
import scenarioOne from './scenario-one';

const SCENARIOS = new Map<string, TestScenario>([
    [scenarioOne.id, scenarioOne],
]);

export function getScenario(id: string): TestScenario | undefined {
    return SCENARIOS.get(id);
}

export function getAllScenarioIds(): string[] {
    return [...SCENARIOS.keys()];
}
