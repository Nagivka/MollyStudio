// Offline build helper. No Minecraft classes or Java runtime are shipped with the app.
import java.lang.reflect.*;
import java.nio.file.*;
import java.util.*;
import com.google.gson.*;
import org.joml.*;

class ExportMinecraftEntities {
    static final Gson JSON = new GsonBuilder().create();
    static Object field(Object object, String name) throws Exception {
        Field field = object.getClass().getDeclaredField(name);
        field.setAccessible(true);
        return field.get(object);
    }
    static float number(Object object, String name) throws Exception { return ((Number)field(object,name)).floatValue(); }
    static void visit(Object part, Matrix4f parent, List<Object> output) throws Exception {
        if (!(boolean)field(part,"visible")) return;
        Matrix4f transform = new Matrix4f(parent)
            .translate(number(part,"x"),number(part,"y"),number(part,"z"))
            .rotateZYX(number(part,"zRot"),number(part,"yRot"),number(part,"xRot"))
            .scale(number(part,"xScale"),number(part,"yScale"),number(part,"zScale"));
        if (!(boolean)field(part,"skipDraw")) for (Object cube : (List<?>)field(part,"cubes")) {
            for (Object polygon : (Object[])field(cube,"polygons")) {
                List<Object> vertices = new ArrayList<>();
                for (Object vertex : (Object[])field(polygon,"vertices")) {
                    Vector3f pos = transform.transformPosition(new Vector3f(number(vertex,"x"),number(vertex,"y"),number(vertex,"z")));
                    vertices.add(new float[]{pos.x,-pos.y,pos.z,number(vertex,"u"),number(vertex,"v")});
                }
                Vector3f normal = new Matrix3f(transform).invert().transpose().transform(new Vector3f((Vector3fc)field(polygon,"normal"))).normalize();
                output.add(Map.of("vertices",vertices,"normal",new float[]{normal.x,-normal.y,normal.z}));
            }
        }
        for (Object child : ((Map<?,?>)field(part,"children")).values()) visit(child,transform,output);
    }
    public static void main(String[] args) throws Exception {
        JsonArray definitions = JsonParser.parseString(Files.readString(Path.of(args[0]))).getAsJsonArray();
        Path output = Path.of(args[1]); Files.createDirectories(output);
        for (JsonElement entry : definitions) {
            JsonObject entity = entry.getAsJsonObject();
            List<Object> layers = new ArrayList<>();
            for (JsonElement layerEntry : entity.getAsJsonArray("layers")) {
                JsonObject layer = layerEntry.getAsJsonObject();
                Class<?> model = Class.forName("net.minecraft.client.model."+layer.get("model").getAsString());
                String method = layer.has("method") ? layer.get("method").getAsString() : "createBodyLayer";
                Object baked = null;
                for (Method factory : model.getMethods()) if (factory.getName().equals(method) && Modifier.isStatic(factory.getModifiers())) {
                    Object[] parameters = new Object[factory.getParameterCount()];
                    for (int i=0;i<parameters.length;i++) {
                        Class<?> type = factory.getParameterTypes()[i];
                        if (type.getSimpleName().equals("CubeDeformation")) parameters[i]=type.getConstructor(float.class).newInstance(layer.has("deformation")?layer.get("deformation").getAsFloat():0f);
                        else if (type==float.class) parameters[i]=0f;
                        else throw new IllegalArgumentException("Unsupported factory parameter "+type);
                    }
                    baked=factory.invoke(null,parameters); break;
                }
                if (baked==null) throw new IllegalArgumentException("No model factory: "+model+"."+method);
                if (baked.getClass().getSimpleName().equals("MeshDefinition")) {
                    Class<?> definition=Class.forName("net.minecraft.client.model.geom.builders.LayerDefinition");
                    JsonArray size=layer.getAsJsonArray("textureSize");
                    baked=definition.getMethod("create",baked.getClass(),int.class,int.class).invoke(null,baked,size.get(0).getAsInt(),size.get(1).getAsInt());
                }
                Object root=baked.getClass().getMethod("bakeRoot").invoke(baked);
                List<Object> faces=new ArrayList<>();visit(root,new Matrix4f(),faces);
                layers.add(Map.of("texture",layer.get("texture").getAsString(),"opacity",layer.has("opacity")?layer.get("opacity").getAsFloat():1f,"emissive",layer.has("emissive")&&layer.get("emissive").getAsBoolean(),"faces",faces));
            }
            Files.writeString(output.resolve(entity.get("id").getAsString()+".json"),JSON.toJson(layers));
            System.out.println(entity.get("id").getAsString());
        }
    }
}
