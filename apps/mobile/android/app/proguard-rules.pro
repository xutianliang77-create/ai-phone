# ONNX Runtime's Android Java bindings use JNI names at runtime.
# Required by https://onnxruntime.ai/docs/build/android.html for R8 builds.
-keep class ai.onnxruntime.** { *; }
