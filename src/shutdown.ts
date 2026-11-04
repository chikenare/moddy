export async function runShutdown(steps: Array<[name: string, step: () => unknown]>): Promise<void> {
  for (const [name, step] of steps) {
    try {
      await step();
    } catch (e) {
      console.error(`Error al cerrar (${name}):`, e);
    }
  }
}
