// 마이크 입력을 1024샘플 묶음으로 메인 스레드에 넘긴다
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(1024);
    this.i = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let k = 0; k < ch.length; k++) {
        this.buf[this.i++] = ch[k];
        if (this.i === this.buf.length) {
          this.port.postMessage(this.buf.slice(0));
          this.i = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('capture', CaptureProcessor);
