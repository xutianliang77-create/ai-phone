import Foundation
@main struct ActivityTests {
  static func main() throws {
    func decode(_ values:[[Float]], step:Int) throws -> [[Float]] {
      var decoder=DeviceSpeakerActivityDecoder(),output:[Float]=[]
      for start in stride(from:0,to:values.count,by:step) {
        let result=try decoder.consume(Array(values[start..<min(start+step,values.count)]).flatMap{$0},startFrame:start)
        assert(result.startFrame==output.count/4);output += result.probabilities
      }
      let final=decoder.flush();assert(final.startFrame==output.count/4);output += final.probabilities
      return stride(from:0,to:output.count,by:4).map{Array(output[$0..<$0+4])}
    }
    let off:[Float]=[0,0,0,0],on:[Float]=[0.9,0,0,0]
    for step in [1,2,6,24] {
      let impulse=try decode([off,on,off],step:step)
      assert(impulse.allSatisfy{$0[0]==0})
      let two=try decode([off,on,on,off],step:step)
      assert(two.map{$0[0]>0.5} == [false,true,true,false])
      let short=try decode([on,on,off,off,off,on,on],step:step)
      assert(short.allSatisfy{$0[0]>0.5})
      let long=try decode([on,on,off,off,off,off,on,on],step:step)
      assert(long.map{$0[0]>0.5} == [true,true,false,false,false,false,true,true])
      let overlap=try decode([[0.9,0.8,0,0],[0.8,0.9,0,0],off],step:step)
      assert(overlap[0][0]>0.5 && overlap[0][1]>0.5 && overlap[2].allSatisfy{$0==0})
    }
    print("PASS: frozen v1 100ms-on/320ms-off policy, impulses/gaps/overlap/end, independent of chunking")
  }
}
