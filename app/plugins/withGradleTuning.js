// Keeps the Android build inside the memory of a free EAS build machine.
// Builds 1 to 3 died with "Gradle build daemon disappeared unexpectedly":
// the Gradle daemon (4 GB), a separate Kotlin daemon and parallel C++/Java
// workers together outgrew the machine. This runs Kotlin inside Gradle and
// caps the parallel work. Builds get a little slower, nothing else changes.
const { withGradleProperties } = require('expo/config-plugins');

const PROPS = {
  'org.gradle.jvmargs': '-Xmx3g -XX:MaxMetaspaceSize=768m -XX:+HeapDumpOnOutOfMemoryError -Dfile.encoding=UTF-8',
  'org.gradle.parallel': 'false',
  'org.gradle.workers.max': '2',
  'kotlin.compiler.execution.strategy': 'in-process',
};

module.exports = function withGradleTuning(config) {
  return withGradleProperties(config, (cfg) => {
    for (const [key, value] of Object.entries(PROPS)) {
      cfg.modResults = cfg.modResults.filter((p) => !(p.type === 'property' && p.key === key));
      cfg.modResults.push({ type: 'property', key, value });
    }
    return cfg;
  });
};
